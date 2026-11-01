#!/usr/bin/env python3
"""檢查 data/questions.json 並回報問題。用法：python scripts/validate.py [--seed N]"""
import argparse
import difflib
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BROKEN_WORDS = re.compile(r"\b(?:tra ic|o icial|o ice|sta |di erent|a ect|e ect|e ort|su ic|insu ic|sni er|bu er|o set|o line)", re.I)
RESIDUE = re.compile(r"[Ưﬀ-ﬄ☐•店铺]|#{3,}|\bof 411\b|ECCouncil - 312|Shutterstock")


def norm(text):
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def show(q):
    print(f"\n[{q['id']}] 來源 {q['source']}  answerSource={q['answerSource']}  category={q.get('category', '')}")
    print(q["question"])
    for k, v in q["options"].items():
        print(f"  {'*' if k in q['answer'] else ' '} {k}. {v}")
    print(f"  答案：{q['answer']}")
    if q["explanation"]:
        print(f"  解析：{q['explanation'][:500]}")


def find_duplicates(questions):
    exact = defaultdict(list)
    for q in questions:
        exact[norm(q["question"])].append(q["id"])
    groups = [ids for ids in exact.values() if len(ids) > 1]
    # 近似題：開頭或用字高度相似。先用共同的詞過濾，避免全部兩兩比對。
    words = [set(norm(q["question"]).split()) for q in questions]
    near = []
    seen = {i for g in groups for i in g}
    for i, a in enumerate(questions):
        for j in range(i + 1, len(questions)):
            b = questions[j]
            if not words[i] or not words[j]:
                continue
            overlap = len(words[i] & words[j]) / min(len(words[i]), len(words[j]))
            if overlap < 0.7 or (a["id"] in seen and b["id"] in seen):
                continue
            ratio = difflib.SequenceMatcher(None, norm(a["question"]), norm(b["question"])).ratio()
            if ratio >= 0.85:
                near.append((a["id"], b["id"], round(ratio, 3), same_option(a, b)))
    return groups, near


def same_option(a, b):
    """判斷兩題的答案是不是同一個選項：把 a 的答案對應到 b 最相近的選項，不要求字串完全相同。"""
    def closest(text):
        return max(b["options"], key=lambda k: difflib.SequenceMatcher(None, norm(text), norm(b["options"][k])).ratio())
    return {closest(a["options"][k]) for k in a["answer"]} == set(b["answer"])


def check_merges(questions):
    """已合併的題目：答案必須對應到同一選項，或保留題已標 disputed。"""
    by_id = {q["id"]: q for q in questions}
    hidden = [q for q in questions if "duplicateOf" in q]
    bad = []
    for q in hidden:
        kept = by_id[q["duplicateOf"]]
        if "duplicateOf" in kept:
            bad.append((q["id"], "保留題本身也被隱藏"))
        elif not same_option(q, kept) and not kept.get("answerConfirmed"):
            bad.append((q["id"], kept["id"]))
    print(f"已合併 {len(hidden)} 題，可出題 {len(questions) - len(hidden)} 題")
    for q in questions:
        if q.get("corrected"):
            print(f"  已修正 {q['id']}：PDF {q['pdfAnswer']} → {q['answer']}")
    print("已確認 PDF 正確：", [q["id"] for q in questions if q.get("answerConfirmed")])
    print("相似題群組：", [q["id"] for q in questions if q.get("similarGroup")])
    print("合併後答案不一致且未裁決：", bad or "無")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    questions = json.loads((ROOT / "data/questions.json").read_text("utf-8"))
    report = json.loads((ROOT / "data/parse_report.json").read_text("utf-8"))
    rng = random.Random(args.seed)

    print("== 題數 ==")
    counts = Counter(q["source"] for q in questions)
    for source, count in sorted(counts.items()):
        print(f"{source}: {count}")
    print(f"總共: {len(questions)}")

    print("\n== 缺少答案 ==")
    print([q["id"] for q in questions if not q["answer"]] or "無")
    print("\n== 選項少於 2 個 ==")
    print([q["id"] for q in questions if len(q["options"]) < 2] or "無")
    print("\n== 選項數分布 ==")
    print(Counter(len(q["options"]) for q in questions))
    print("\n== 答案不在選項內 ==")
    print([q["id"] for q in questions if any(a not in q["options"] for a in q["answer"])] or "無")
    print("\n== 空白題幹或選項 ==")
    print([q["id"] for q in questions if not q["question"] or not all(q["options"].values())] or "無")

    print("\n== 題號不連續 ==")
    by_source = defaultdict(list)
    for q in questions:
        by_source[q["source"]].append(q["number"])
    for source, numbers in sorted(by_source.items()):
        missing = sorted(set(range(1, max(numbers) + 1)) - set(numbers))
        print(f"{source}: 缺 {missing or '無'}")
    print("PDF 答案表有、題目卻不存在：", report["no_question"] or "無")

    print("\n== 重複題目 ==")
    groups, near = find_duplicates(questions)
    print(f"內容相同：{len(groups)} 組")
    for group in groups:
        print("  " + ", ".join(group))
    print(f"高度相似（>=0.85）：{len(near)} 組")
    for a, b, ratio, same in near:
        print(f"  {a} ~ {b}  相似度 {ratio}  答案{'是同一選項' if same else '不同'}")
    check_merges(questions)

    print("\n== 03 粗體偵測 ==")
    bold = report["bold03"]
    print(f"恰好 1 個粗體：{bold['one']} 題")
    print(f"0 個粗體：{bold['none'] or '無'}")
    print(f"2 個以上粗體：{bold['many'] or '無'}")

    print("\n== 其他修復與檢查 ==")
    print("答案表比對不到選項：", report["unmatched_answers"] or "無")
    print("答案表附註：", report["answer_notes"] or "無")
    print("04 假選項 E 修復：", report["e_option_fixed"])
    print("文字還原：", report["repairs"] or "無")
    q101 = next(q for q in questions if q["id"] == "03-101")
    print("03-101 選項 D：", q101["options"].get("D"))
    print("含圖片的題目：", [q["id"] for q in questions if q["hasImage"]] or "無")
    print("多選題：", [q["id"] for q in questions if q["multi"]] or "無")
    print("04 分類：", json.dumps(report["categories"], ensure_ascii=False, indent=1))

    residue, broken = [], []
    for q in questions:
        blob = " ".join([q["question"], q["explanation"], *q["options"].values()])
        if RESIDUE.search(blob):
            residue.append((q["id"], RESIDUE.search(blob).group()))
        if BROKEN_WORDS.search(blob):
            broken.append((q["id"], BROKEN_WORDS.search(blob).group()))
    conflicts = []
    for q in questions:
        stated = set(re.findall(r"\bOption ([A-D]) is (?:the )?correct", q["explanation"]))
        if stated and stated != set(q.get("pdfAnswer", q["answer"])):
            conflicts.append((q["id"], q["answer"], sorted(stated)))
    print("解析寫的正確選項和答案不一致：", conflicts or "無")
    print("頁首頁尾 / 特殊字元殘留：", residue or "無")
    print("連字殘留：", broken or "無")

    print("\n== 隨機抽 5 題 ==")
    for q in rng.sample(questions, 5):
        show(q)
    print("\n== 03 隨機抽 10 題（核對粗體答案）==")
    for q in sorted(rng.sample([q for q in questions if q["source"] == "ceh13-03.pdf"], 10), key=lambda q: q["number"]):
        show(q)


if __name__ == "__main__":
    main()
