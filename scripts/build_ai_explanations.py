#!/usr/bin/env python3
"""把 scripts/ai_explanations/batch*.txt 合併成 data/explanations_ai.json，並檢查完整性。

每行格式：題目 id|分類簡稱|解析[|爭議理由]
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = {
    "Info": "Information Security and Ethical Hacking Overview",
    "Recon": "Reconnaissance Techniques",
    "Sys": "System Hacking Phases",
    "Net": "Network and Perimeter Hacking",
    "Ops": "Security Operations and Incident Response",
    "Web": "Web Application Hacking",
    "Wifi": "Wireless Network Hacking",
    "Cloud": "Cloud Computing",
    "Mal": "Malware Threats",
    "Mob": "Mobile Platform, IoT, and OT Hacking",
    "Crypto": "Cryptography",
    "Soc": "Social Engineering",
}


def main():
    questions = {q["id"]: q for q in json.loads((ROOT / "data/questions.json").read_text("utf-8"))}
    wanted = {i for i, q in questions.items() if not q["explanation"] and "duplicateOf" not in q}
    result = {}
    for path in sorted((Path(__file__).parent / "ai_explanations").glob("batch*.txt")):
        for line in path.read_text("utf-8").splitlines():
            if not line.strip():
                continue
            parts = line.split("|")
            if len(parts) not in (3, 4):
                raise SystemExit(f"格式錯誤：{line[:80]}")
            qid, category, text = parts[:3]
            if qid in result:
                raise SystemExit(f"重複：{qid}")
            entry = {"explanation": text, "category": CATEGORIES[category], "categorySource": "ai"}
            if len(parts) == 4:
                entry.update(disputed=True, disputeReason=parts[3])
            result[qid] = entry

    if set(result) != wanted:
        raise SystemExit(f"缺少 {sorted(wanted - set(result))}；多出 {sorted(set(result) - wanted)}")
    (ROOT / "data/explanations_ai.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")
    disputed = sorted(i for i, e in result.items() if e.get("disputed"))
    print(f"AI 解析 {len(result)} 題，AI 標記 disputed {len(disputed)} 題：{disputed}")


if __name__ == "__main__":
    main()
