#!/usr/bin/env python3
"""把 ceh13-01.pdf ~ ceh13-04.pdf 解析成 data/questions.json。

用法：python scripts/parse_pdf.py
另外輸出 data/parse_report.json，供 scripts/validate.py 回報解析時發現的問題。
"""
import json
import re
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES = DATA / "images"
AI_ANSWERS_03 = Path(__file__).with_name("ai_answers_03.json")
DUPLICATES = Path(__file__).with_name("duplicates.json")
DISPUTES = Path(__file__).with_name("disputes.json")
SIMILAR_GROUPS = Path(__file__).with_name("similar_groups.json")

LIGATURES = {"Ư": "ff", "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl"}
# 04 的文字裡有一處被遮蔽，依上下文還原（會列入報告）
TEXT_REPAIRS = {"#######-defined": "well-defined"}
# 04 的分類有 OCR 變體，統一成一個名稱
CATEGORY_ALIASES = {
    "Mobile Platform and loT Hacking": "Mobile Platform, IoT, and OT Hacking",
    "Mobile Platform and IoT Hacking": "Mobile Platform, IoT, and OT Hacking",
    "Mobile Platform, loT, and OT Hacking": "Mobile Platform, IoT, and OT Hacking",
}

report = {"repairs": [], "unmatched_answers": [], "no_question": [], "answer_notes": [],
          "bold03": {"one": 0, "none": [], "many": []}, "e_option_fixed": [], "categories": {}}


def fix_text(text):
    for bad, good in LIGATURES.items():
        text = text.replace(bad, good)
    return text


def collapse(text):
    text = re.sub(r"\s+", " ", text).strip()
    # 在連字號處換行的字接回去（sequence- related → sequence-related）
    return re.sub(r"(?<=[A-Za-z])- (?=[a-z])", "-", text)


def norm(text):
    """比對答案文字用：忽略大小寫、空白與標點差異。"""
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[^a-z0-9$%]+", "", text)


def page_lines(page):
    """回傳頁面上的行（依 y、x 排序），同一列的片段合併成一行。"""
    raw = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line["spans"]
            text = fix_text("".join(s["text"] for s in spans))
            if text.strip():
                raw.append({"x": line["bbox"][0], "y": line["bbox"][1], "y2": line["bbox"][3],
                            "text": text, "spans": spans})
    raw.sort(key=lambda l: l["y"])
    rows = []
    for line in raw:
        if rows and abs(rows[-1][0]["y"] - line["y"]) < 4:
            rows[-1].append(line)
        else:
            rows.append([line])
    merged = []
    for row in rows:
        # 項目符號和文字的 y 略有差異，同一列一律依 x 排序
        row.sort(key=lambda l: l["x"])
        merged.append({"x": row[0]["x"], "y": row[0]["y"], "y2": row[0]["y2"],
                       "text": " ".join(l["text"].strip() for l in row),
                       "spans": [s for l in row for s in l["spans"]]})
    return merged


def is_bold(span):
    return bool(span["flags"] & 16) or "Bold" in span["font"]


def make_question(file_no, number, source, stem, options, answer, explanation="", answer_source="pdf", **extra):
    question = {
        "id": f"{file_no}-{number:03d}",
        "source": source,
        "number": number,
        "question": collapse(stem),
        "options": {k: collapse(v) for k, v in options.items()},
        "answer": answer,
        "explanation": explanation,
        "multi": len(answer) > 1,
        "answerSource": answer_source,
        "hasImage": False,
    }
    question.update(extra)
    return question


def read_answer_key(doc, start_page):
    """答案表是兩欄表格：題號在左、答案在右。依垂直距離配對，可處理換行與跨頁的列。"""
    key = {}
    last_number = None
    for page in doc.pages(start_page):
        lines = page_lines_raw(page)
        numbers = [(l, int(l["text"].strip())) for l in lines if l["x"] < 120 and l["text"].strip().isdigit()]
        for line in lines:
            if line["x"] < 120 or "Answer)" in line["text"]:
                continue
            center = (line["y"] + line["y2"]) / 2
            nearest = min(numbers, key=lambda n: abs((n[0]["y"] + n[0]["y2"]) / 2 - center), default=None)
            if nearest and abs((nearest[0]["y"] + nearest[0]["y2"]) / 2 - center) < 16:
                number = nearest[1]
            else:
                number = last_number  # 前一頁延續下來的列
            key[number] = (key.get(number, "") + " " + line["text"]).strip()
            last_number = number
    return key


def page_lines_raw(page):
    """答案表不可合併同列（題號和答案要分開），只整理文字。"""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = fix_text("".join(s["text"] for s in line["spans"])).strip()
            if text:
                lines.append({"x": line["bbox"][0], "y": line["bbox"][1], "y2": line["bbox"][3], "text": text})
    lines.sort(key=lambda l: (l["y"], l["x"]))
    return lines


def parse_bulleted(path, file_no, bullet_chars):
    """01、02：無字母選項，答案在檔尾表格。"""
    doc = pymupdf.open(path)
    key_page = next(i for i, p in enumerate(doc) if "Answer)" in p.get_text())
    key = read_answer_key(doc, key_page)

    questions, current, expected = [], None, 1
    for page in doc.pages(0, key_page):
        for line in page_lines(page):
            text = line["text"].strip()
            match = re.match(r"^(\d{1,3})\.\s*(\S.*)$", text)
            number = int(match.group(1)) if match else None
            # 只接受遞增的題號，避免把題幹內的數字開頭行（例如 IP 位址）當成新題
            if match and expected <= number <= expected + 2 and not re.match(r"^\d+\.\d", text):
                current = {"number": number, "stem": match.group(2), "options": []}
                questions.append(current)
                expected = number + 1
            elif current is None:
                continue
            elif text[0] in bullet_chars:
                current["options"].append(text[1:].strip())
            elif current["options"]:
                current["options"][-1] += " " + text
            else:
                current["stem"] += " " + text

    result = []
    found = {q["number"] for q in questions}
    source = path.name
    for number in sorted(set(key) - found):
        report["no_question"].append({"source": source, "number": number, "keyText": key[number]})
    for q in questions:
        options = {chr(65 + i): o for i, o in enumerate(q["options"])}
        key_text = collapse(key.get(q["number"], ""))
        answer = match_answer(key_text, options)
        if not answer:
            report["unmatched_answers"].append({"id": f"{file_no}-{q['number']:03d}", "keyText": key_text,
                                                "options": options})
        result.append(make_question(file_no, q["number"], source, q["stem"], options, answer))
    return result


def match_answer(key_text, options):
    target = norm(key_text)
    if not target:
        return []
    exact = [k for k, v in options.items() if norm(v) == target]
    if len(exact) == 1:
        return exact
    # 答案表附註（如「Pharming (或視不同題庫版本為 …)」）：比對括號前的文字
    head = norm(re.split(r"[(（]", key_text)[0])
    partial = [k for k, v in options.items() if head and norm(v) == head]
    if len(partial) == 1:
        report["answer_notes"].append({"keyText": key_text, "matched": options[partial[0]]})
        return partial
    return []


def parse_03(path):
    """03：`• (A) …`，正確選項為粗體；第一行的字型決定該選項是否粗體。"""
    doc = pymupdf.open(path)
    ai_answers = json.loads(AI_ANSWERS_03.read_text("utf-8")) if AI_ANSWERS_03.exists() else {}
    questions, current, expected = [], None, 1
    for page in doc:
        for line in page_lines(page):
            text = line["text"].strip()
            if text.startswith("CEH v13 (312-50v13)") or text == "Shutterstock":
                continue
            option = re.match(r"^•\s*\(([A-Z])\)\s*(.*)$", text)
            number = re.match(r"^(\d{1,3})\.\s+(\S.*)$", text)
            if option and current:
                # 判斷粗體只看選項文字，排除符號字型的項目符號和行尾空白
                body = [s for s in line["spans"] if s["text"].strip() and "Symbol" not in s["font"]]
                bold = bool(body) and is_bold(body[0])
                current["options"][option.group(1)] = option.group(2)
                if bold:
                    current["bold"].append(option.group(1))
                current["last"] = option.group(1)
            elif number and int(number.group(1)) == expected:
                current = {"number": expected, "stem": number.group(2), "options": {}, "bold": [], "last": None}
                questions.append(current)
                expected += 1
            elif current is None:
                continue
            elif current["last"]:
                current["options"][current["last"]] += " " + text
            else:
                current["stem"] += " " + text

    result = []
    for q in questions:
        qid = f"03-{q['number']:03d}"
        answer, source = q["bold"], "pdf"
        if len(q["bold"]) == 1:
            report["bold03"]["one"] += 1
        else:
            report["bold03"]["none" if not q["bold"] else "many"].append(q["number"])
            answer, source = ai_answers.get(qid, []), "ai"
        result.append(make_question("03", q["number"], path.name, q["stem"], q["options"], answer,
                                    answer_source=source))
    return result


def parse_04(path):
    """04：`Question #:N - [分類]`，選項 `A.`，答案 `Answer: X`，後接 Explanation。"""
    doc = pymupdf.open(path)
    logo_xrefs = {img[0] for page in doc for img in page.get_images()}
    questions, current, state = [], None, None
    for page in doc:
        for line in page_lines(page):
            text = line["text"].strip()
            if (re.fullmatch(r"\d+ of \d+", text) or text == "ECCouncil - 312-50v13"
                    or re.search("[店铺]", text)):
                continue
            head = re.match(r"^Question #:\s*(\d+)\s*(?:-\s*\[(.*))?$", text)
            if head:
                category = head.group(2) or ""
                current = {"number": int(head.group(1)), "category": category.rstrip("]"),
                           "stem": "", "options": {}, "answer": [], "exp": [], "last": None}
                questions.append(current)
                # 分類標題可能跨頁（如第 48 題），收到 `]` 才算結束
                state = "stem" if category.endswith("]") else "category"
                continue
            if current is None:
                continue
            if state == "category":
                current["category"] = collapse(current["category"] + " " + text.rstrip("]"))
                if text.endswith("]"):
                    state = "stem"
                continue
            option = re.match(r"^([A-E])\.\s*(.*)$", text)
            answer = re.match(r"^Answer:\s*((?:[A-Z][\s,]*)+)$", text)
            if state in ("stem", "options") and answer:
                current["answer"] = re.findall(r"[A-Z]", answer.group(1))
                state = "after"
            elif state in ("stem", "options") and option:
                label, body = option.groups()
                # 跨頁時選項字母可能印兩次（空的 B. 接著 B. 內容），併回同一個選項
                current["options"][label] = (current["options"].get(label, "") + " " + body).strip()
                current["last"] = label
                state = "options"
            elif state == "stem":
                current["stem"] += " " + text
            elif state == "options":
                current["options"][current["last"]] += " " + text
            elif state == "after":
                if text != "Explanation":
                    current["exp"].append(text)

    result = []
    for q in questions:
        options, answer, explanation = q["options"], q["answer"], paragraphs(q["exp"])
        # 8 題的解析被放進假選項 E：開頭字母是答案，其餘是解析，`Answer: A B C D E` 無效
        if "E" in options and re.match(r"^[A-D][A-Z]", options["E"]):
            text = options.pop("E")
            answer, explanation = [text[0]], paragraphs([text[1:]])
            report["e_option_fixed"].append({"number": q["number"], "answer": text[0]})
        category = CATEGORY_ALIASES.get(q["category"], q["category"])
        # 第 48 題的標題跨頁，PDF 只留下「Hacking]」；依題目內容（網頁伺服器 URL 測試）還原
        if q["number"] == 48 and category == "Hacking":
            category = "Web Application Hacking"
            report["repairs"].append({"id": "04-048", "from": "category: Hacking]", "to": category})
        report["categories"][category] = report["categories"].get(category, 0) + 1
        for bad, good in TEXT_REPAIRS.items():
            if bad in explanation:
                explanation = explanation.replace(bad, good)
                report["repairs"].append({"id": f"04-{q['number']:03d}", "from": bad, "to": good})
        result.append(make_question("04", q["number"], path.name, q["stem"], options, answer,
                                    explanation, category=category))
    report["logo_xrefs_04"] = sorted(logo_xrefs)
    return result


def paragraphs(lines):
    """以句號結尾的短行視為段落結束，其餘接回同一段。"""
    out, current = [], ""
    for line in lines:
        current = (current + " " + line).strip()
        if len(line) < 80 and line.rstrip().endswith((".", ":", "?")):
            out.append(current)
            current = ""
    if current:
        out.append(current)
    # PDF 中段落相接處缺空白（stability.This）
    return "\n".join(re.sub(r"(?<=[a-z]{2})\.(?=[A-Z][a-z])", ". ", collapse(p)) for p in out)


def apply_duplicates(questions):
    """duplicates.json：{"被隱藏的題目 id": "保留的題目 id"}；disputes.json：兩版答案不同的保留題。"""
    by_id = {q["id"]: q for q in questions}
    if DUPLICATES.exists():
        for hidden, kept in json.loads(DUPLICATES.read_text("utf-8")).items():
            by_id[hidden]["duplicateOf"] = kept
            # 解析不複製：選項順序可能不同，解析中的字母會對不上。顯示時改用保留版本。
            by_id[hidden]["category"] = by_id[kept]["category"]
    # 使用者已裁決的答案：corrected 改答案並保留 PDF 原答案；confirmed 維持 PDF 答案、不顯示疑義
    if DISPUTES.exists():
        for qid, ruling in json.loads(DISPUTES.read_text("utf-8")).items():
            q = by_id[qid]
            if "altFrom" in ruling:
                q["altFrom"] = ruling["altFrom"]
            if ruling["ruling"] == "corrected":
                q["pdfAnswer"] = q["answer"]
                q["answer"] = ruling["answer"]
                q["corrected"] = True
                q["correctionReason"] = ruling["reason"]
            else:
                q["answerConfirmed"] = True
    # 相似題：不是重複題，但同一次模擬考、同一輪刷題只抽其中一題
    if SIMILAR_GROUPS.exists():
        for group, ids in json.loads(SIMILAR_GROUPS.read_text("utf-8")).items():
            for qid in ids:
                by_id[qid]["similarGroup"] = group


def main():
    DATA.mkdir(exist_ok=True)
    IMAGES.mkdir(exist_ok=True)
    questions = []
    questions += parse_bulleted(ROOT / "ceh13-01.pdf", "01", "☐")
    questions += parse_bulleted(ROOT / "ceh13-02.pdf", "02", "☐")
    questions += parse_03(ROOT / "ceh13-03.pdf")
    questions += parse_04(ROOT / "ceh13-04.pdf")
    apply_duplicates(questions)
    (DATA / "questions.json").write_text(json.dumps(questions, ensure_ascii=False, indent=1), "utf-8")
    (DATA / "parse_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), "utf-8")
    print(f"wrote {len(questions)} questions")


if __name__ == "__main__":
    main()
