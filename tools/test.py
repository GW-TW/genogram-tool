"""跑全部測試（輸出節流：只印失敗行＋總結行）。

1. 單元測試：無頭瀏覽器以 file:// 開 tests/run.html（跟社工實際開檔的環境一樣），等測試跑完再讀結果。
2. 打包檔開機測試：開 dist/家系圖工具.html#selftest，確認在 CSP 限制下能開機、畫圖、產生 PNG，且沒有錯誤。

怎麼「等跑完」：用瀏覽器除錯協定（CDP，只綁 127.0.0.1、隨機埠）連進頁面，每 0.2 秒實際查一次完成旗標。
（2026-09-18 起改用這個方式：原本的 --dump-dom＋--virtual-time-budget 在有背景執行緒的非同步工作
  ——例如解壓 .gno 的 DecompressionStream——時，虛擬時間會直接快轉到底，頁面在測試跑完前就被匯出，
  Edge 153 上 8 次失敗 3 次。）

用法：PYTHONIOENCODING=utf-8 python tools/test.py          （全部）
      PYTHONIOENCODING=utf-8 python tools/test.py --unit   （只跑單元測試）
結束碼：0＝全過；1＝有失敗；2＝環境問題（找不到瀏覽器、瀏覽器沒有回應）
"""
import base64
import json
import os
import pathlib
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CANDIDATES = [
    os.environ.get("EDGE_PATH", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]


class BrowserUnavailable(Exception):
    """這支瀏覽器沒有開起除錯介面（例如 Edge 正在自動更新、等重新啟動）——換下一支。"""


class NoBrowserOutput(Exception):
    """所有瀏覽器都不能用——是環境問題，不是測試失敗。"""


def browsers() -> list:
    seen, out = set(), []
    for c in CANDIDATES:
        if c and c not in seen and pathlib.Path(c).exists():
            seen.add(c)
            out.append(c)
    return out


# ── 最小的 websocket 用戶端（只夠跟 CDP 說話：文字訊框、遮罩、分段、ping）──
class WebSocket:
    def __init__(self, url: str, timeout: float = 30):
        m = re.match(r"ws://([^/:]+):(\d+)(/.*)", url)
        if not m:
            raise BrowserUnavailable("bad websocket url")
        host, port, path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise BrowserUnavailable("websocket handshake closed")
            head += chunk
        status, self.buf = head.split(b"\r\n\r\n", 1)
        if b" 101 " not in status.split(b"\r\n")[0]:
            raise BrowserUnavailable("websocket handshake refused")
        self.next_id = 0

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode: int, data: bytes) -> None:
        head = bytearray([0x80 | opcode])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self) -> dict:
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x9:                      # ping → pong
                self._send_frame(0xA, payload)
                continue
            if opcode == 0x8:
                raise ConnectionError("websocket closed by browser")
            if opcode in (0x0, 0x1, 0x2):
                message += payload
                if b1 & 0x80:
                    return json.loads(message.decode("utf-8"))

    def call(self, method: str, params: dict = None) -> dict:
        self.next_id += 1
        mid = self.next_id
        self._send_frame(0x1, json.dumps({"id": mid, "method": method, "params": params or {}}).encode("utf-8"))
        while True:
            msg = self.recv()
            if msg.get("id") == mid:
                return msg

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


def evaluate(ws: WebSocket, expression: str):
    r = ws.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
    return r.get("result", {}).get("result", {}).get("value")


def run_page_with(exe: str, url: str, done_expr: str, result_expr: str, timeout: float) -> tuple:
    profile = tempfile.mkdtemp(prefix="gt-edge-")
    proc = subprocess.Popen(
        [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
         "--disable-extensions", f"--user-data-dir={profile}", "--remote-debugging-address=127.0.0.1",
         "--remote-debugging-port=0", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser_ws = page = None
    try:
        port_file = pathlib.Path(profile) / "DevToolsActivePort"
        deadline = time.time() + 20
        while time.time() < deadline and not (port_file.exists() and len(port_file.read_text().split()) >= 2):
            time.sleep(0.1)
        if not port_file.exists():
            raise BrowserUnavailable("no DevToolsActivePort")
        port, browser_path = port_file.read_text().split()[:2]
        browser_ws = WebSocket(f"ws://127.0.0.1:{port}{browser_path}")
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=10) as r:
            targets = json.loads(r.read().decode("utf-8"))
        target = next((t for t in targets if t.get("type") == "page"), None)
        if not target:
            raise BrowserUnavailable("no page target")
        page = WebSocket(target["webSocketDebuggerUrl"])
        page.call("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        finished = False
        while time.time() < deadline:
            if evaluate(page, done_expr) is True:
                finished = True
                break
            time.sleep(0.2)
        return finished, evaluate(page, result_expr)
    finally:
        for ws in (page, browser_ws):
            if ws is browser_ws and ws:
                try:
                    ws.call("Browser.close")
                except (OSError, ConnectionError, ValueError):
                    pass
            if ws:
                ws.close()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        for _ in range(20):                         # 瀏覽器關掉後設定檔才解鎖
            shutil.rmtree(profile, ignore_errors=True)
            if not os.path.exists(profile):
                break
            time.sleep(0.25)


def run_page(url: str, done_expr: str, result_expr: str, timeout: float = 60) -> tuple:
    for i, exe in enumerate(browsers()):
        try:
            finished, result = run_page_with(exe, url, done_expr, result_expr, timeout)
        except (BrowserUnavailable, OSError, ConnectionError):
            continue
        if i:
            print(f"（注意：前一個瀏覽器沒有回應，這次改用 {pathlib.Path(exe).name} 執行）")
        return finished, result
    raise NoBrowserOutput()


def run_unit() -> bool:
    finished, text = run_page((ROOT / "tests" / "run.html").as_uri(),
                              "!!(document.body && document.body.dataset.done === '1')",
                              "(document.getElementById('out') || {}).textContent || ''")
    if not finished:
        print("❌ 單元測試在時限內沒有跑完（瀏覽器有開起來，但測試頁停住：可能是 JS 語法錯誤或某個測試卡住）")
        return False
    lines = [ln for ln in (text or "").splitlines() if ln.startswith("❌") or ln.startswith("測試結果")]
    print("\n".join(lines))
    return bool(re.search(r"測試結果：\d+ 通過，0 失敗", text or ""))


def run_smoke() -> bool:
    dist = ROOT / "dist" / "家系圖工具.html"
    if not dist.exists():
        print("❌ 找不到 dist/家系圖工具.html，請先跑 tools/build.py")
        return False
    finished, raw = run_page(dist.as_uri() + "#selftest",
                             "!!(document.body && document.body.dataset.selftest)",
                             "JSON.stringify(document.body ? Object.assign({}, document.body.dataset) : {})")
    data = json.loads(raw or "{}")
    ready = data.get("ready") == "1"
    selftest = data.get("selftest") or "（沒有結果）"
    errors = data.get("errors")
    ok = finished and ready and selftest.startswith("ok:") and not errors
    parts = selftest.split(":")
    detail = f"{parts[1]} 人、PNG {int(parts[2]):,} bytes" if ok and len(parts) == 3 else selftest
    print(("✅" if ok else "❌") + f" 打包檔開機測試：開機={'是' if ready else '否'}，自我測試={detail}"
          + (f"，錯誤 {errors} 次" if errors else ""))
    return ok


def main() -> int:
    if not browsers():
        print("找不到 Edge 或 Chrome，無法執行測試（可設定環境變數 EDGE_PATH）。")
        return 2
    try:
        ok = run_unit()
        if "--unit" not in sys.argv:
            ok = run_smoke() and ok
    except NoBrowserOutput:
        print("⚠️ 瀏覽器開不起來或沒有回應：這是環境問題，不是測試失敗。常見原因是 Edge 剛自動更新、"
              "正在等重新啟動——把 Edge 全部關掉再跑一次；或設定環境變數 EDGE_PATH 指到 Chrome。")
        return 2
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
