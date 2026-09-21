"""產生 tests/fixtures.js：真實 GenoPro 檔＋合成的 GenoPro XML（各種包法）。

- document1：使用者在 GenoPro 3.0.1.5 畫的空白測試圖（5 人、無姓名日期，不含個資）。
- syn*：依 GenoPro 的欄位與列舉值手寫的合成檔，涵蓋姓名、日期、
  自訂欄位、離婚／同居、收養、情感關係、雙胞胎、文字標籤等匯入路徑。
- ZIP 由 Python zipfile 產生，跟工具內的 JS 解壓器是兩套獨立實作，互相驗證。

用法：PYTHONIOENCODING=utf-8 python tools/make_fixtures.py
"""
import base64
import io
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC1 = ROOT / "其他參考程式" / "Document1.gno"
OUT = ROOT / "tests" / "fixtures.js"

SYN = """<?xml version='1.0' encoding='UTF-8'?>
<GenoPro>
  <Software>GenoPro<Version>3.0.1.5</Version></Software>
  <Individuals>
    <Individual ID="ind1">
      <Position BoundaryRect="-26,26,26,-26">0,0</Position>
      <Name>王大明<First>大明</First><Last>王</Last></Name>
      <Gender>M</Gender>
      <Birth><Date>15 Mar 1950</Date></Birth>
      <Occupations><Occupation><Title>工人</Title></Occupation></Occupations>
      <經濟>低收入戶</經濟>
      <Comment>長期失業</Comment>
    </Individual>
    <Individual ID="ind2">
      <Position BoundaryRect="74,26,126,-26">100,0</Position>
      <Name><First>美麗</First><Last>李</Last></Name>
      <Gender>F</Gender>
      <IsDead>Y</IsDead>
      <Death><Date>2019</Date><Age>65</Age></Death>
      <CustomTags><宗教>佛教</宗教></CustomTags>
    </Individual>
    <Individual ID="ind3">
      <Position BoundaryRect="24,-114,76,-166">50,-140</Position>
      <Name>John Smith</Name>
      <Gender>M</Gender>
      <Birth><Date>ABT 1980</Date></Birth>
      <Display><Label><Bottom><Text>高風險</Text></Bottom></Label></Display>
    </Individual>
    <Individual ID="ind4">
      <Position>150,-140</Position>
      <Gender>_Blank</Gender>
      <Pictures><Picture ID="pic1"/></Pictures>
    </Individual>
    <Individual ID="ind5">
      <Position>250,0</Position>
      <Gender>F</Gender>
    </Individual>
  </Individuals>
  <Families>
    <Family ID="fam1"><Relation>Divorce</Relation></Family>
    <Family ID="fam2"><Relation>Cohabitation</Relation></Family>
    <Family ID="fam3"/>
  </Families>
  <PedigreeLinks>
    <PedigreeLink PedigreeLink="Parent" Family="fam1" Individual="ind1"/>
    <PedigreeLink PedigreeLink="Parent" Family="fam1" Individual="ind2"/>
    <PedigreeLink PedigreeLink="Biological" Family="fam1" Individual="ind3"/>
    <PedigreeLink PedigreeLink="Adopted" Family="fam1" Individual="ind4"/>
    <PedigreeLink PedigreeLink="Parent" Family="fam2" Individual="ind1"/>
    <PedigreeLink PedigreeLink="Parent" Family="fam2" Individual="ind5"/>
    <PedigreeLink PedigreeLink="Parent" Family="fam3" Individual="ind999"/>
  </PedigreeLinks>
  <EmotionalRelationships>
    <EmotionalRelationship EmotionalLink="HostileClose" Entity1="ind1" Entity2="ind3"/>
    <EmotionalRelationship EmotionalLink="AbuseSexual" Entity1="ind1" Entity2="ind4"><Comment>通報中</Comment></EmotionalRelationship>
    <EmotionalRelationship EmotionalLink="SomethingNew" Entity1="ind2" Entity2="ind3"/>
    <EmotionalRelationship EmotionalLink="Harmony" Entity1="ind1" Entity2="soc1"/>
  </EmotionalRelationships>
  <Twins><Twin ID="tw1" TwinLink="Identical" Family="fam1" Siblings="ind3,ind4"/></Twins>
  <Labels><Label ID="lbl1"><Position>0,-300</Position><Text>主要照顧者：母</Text></Label></Labels>
</GenoPro>
"""


def zip_bytes(xml: str, method: int) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        info = zipfile.ZipInfo("Data.xml", date_time=(2026, 9, 15, 0, 0, 0))
        info.compress_type = method
        z.writestr(info, xml.encode("utf-8"))
    return buf.getvalue()


def mark_encrypted(data: bytes) -> bytes:
    """把 ZIP 的「已加密」旗標打開（本機與中央目錄各一處），模擬設了密碼的 .gno。"""
    b = bytearray(data)
    b[b.find(b"PK\x03\x04") + 6] |= 1
    b[b.find(b"PK\x01\x02") + 8] |= 1
    return bytes(b)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def main() -> int:
    if not DOC1.exists():
        print(f"找不到 {DOC1}（真實 GenoPro 測試檔），無法產生測試資料。")
        return 1
    fix = {
        "document1": b64(DOC1.read_bytes()),
        "synDeflate": b64(zip_bytes(SYN, zipfile.ZIP_DEFLATED)),
        "synStored": b64(zip_bytes(SYN, zipfile.ZIP_STORED)),
        "synPlain": b64(SYN.encode("utf-8")),
        "synLocked": b64(mark_encrypted(zip_bytes(SYN, zipfile.ZIP_DEFLATED))),
        "garbage": b64("這不是 GenoPro 檔案 hello".encode("utf-8")),
    }
    js = ("/* 由 tools/make_fixtures.py 產生，不要手改 */\n"
          "const FIX = " + json.dumps(fix, indent=1) + ";\n"
          "const fixBytes = (k) => Uint8Array.from(atob(FIX[k]), c => c.charCodeAt(0));\n")
    OUT.write_text(js, encoding="utf-8", newline="\n")
    print(f"已寫入 {OUT.relative_to(ROOT)}（{len(fix)} 組，{OUT.stat().st_size} bytes）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
