"""打包：src/ → dist/家系圖工具.html（單一檔案，雙擊就能用）。

- CSS 與 JS 全部內嵌，不需要網路、不需要安裝。
- 加上 Content-Security-Policy：
  * 禁止一切網路連線（connect-src 'none' 等）→ 個案資料在瀏覽器層級就不可能被送出去。
  * 腳本只允許這次打包的內嵌程式（sha256 雜湊）→ 就算有人在檔案裡塞了 onerror= 之類的東西也不會執行。
- 程式裡的 __BUILD__ 會換成打包時間。

用法：PYTHONIOENCODING=utf-8 python tools/build.py
"""
import base64
import datetime
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "家系圖工具.html"


def lf(text: str) -> str:
    # HTML 解析器會把 CRLF 正規化成 LF 再算雜湊；這裡先統一，雜湊才會對得上
    return text.replace("\r\n", "\n").replace("\r", "\n")


def main() -> int:
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    html = lf((SRC / "index.html").read_text(encoding="utf-8"))
    css = lf((SRC / "style.css").read_text(encoding="utf-8"))

    link = '<link rel="stylesheet" href="style.css">'
    if link not in html:
        print("找不到 style.css 的 <link>，打包中止。")
        return 1
    html = html.replace(link, "<style>\n" + css + "</style>")

    hashes = []
    missing = []

    def inline(m: re.Match) -> str:
        name = m.group(1)
        path = SRC / name
        if not path.exists():
            missing.append(name)
            return m.group(0)
        js = lf(path.read_text(encoding="utf-8")).replace("__BUILD__", stamp)
        if "</script" in js.lower():
            raise SystemExit(f"{name} 內含 </script，無法內嵌。")
        # 原始碼不得含控制字元（2026-09-21：寫檔工具曾把跳脫序列變成真的 NUL 字元混進檔案）
        bad = sorted({ord(ch) for ch in js if ord(ch) < 32 and ord(ch) not in (9, 10, 13)})
        if bad:
            raise SystemExit(f"{name} 含有控制字元（字碼 {bad}），請改寫成跳脫序列。")
        body = "\n" + js + "\n"
        digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode("ascii")
        hashes.append(f"'sha256-{digest}'")
        return "<script>" + body + "</script>"

    html = re.sub(r'<script src="([\w.-]+\.js)"></script>', inline, html)
    if missing:
        print("找不到：" + "、".join(missing))
        return 1
    if re.search(r"<script[^>]+src=", html) or re.search(r"<link[^>]+href=", html):
        print("還有外部資源沒有內嵌，打包中止。")
        return 1

    csp = ("default-src 'none'; script-src " + " ".join(hashes) + "; style-src 'unsafe-inline'; "
           "img-src data: blob:; font-src 'none'; connect-src 'none'; media-src 'none'; "
           "object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'")
    if "<!--CSP-->" not in html:
        print("index.html 缺少 <!--CSP--> 標記，打包中止。")
        return 1
    html = html.replace("<!--CSP-->", f'<meta http-equiv="Content-Security-Policy" content="{csp}">')

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"已打包 {OUT.relative_to(ROOT)}：{OUT.stat().st_size:,} bytes，內嵌腳本 {len(hashes)} 段（{stamp}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
