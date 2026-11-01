#!/usr/bin/env python3
"""用 Playwright（已安裝的 Chrome）測試四個模式與手機版面。用法：python tests/e2e.py"""
import http.server
import json
import re
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(__file__).parent / "screenshots"
PORT = 8765
BASE = f"http://localhost:{PORT}/"
QUESTIONS = {q["id"]: q for q in json.loads((ROOT / "data/questions.json").read_text("utf-8"))}
results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(f"{'PASS' if condition else 'FAIL'}  {name}{'  ' + str(detail) if detail and not condition else ''}")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, *args):
            pass

    class Server(http.server.ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            pass  # 瀏覽器重新整理時中斷連線是正常的

    server = Server(("localhost", PORT), Quiet)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ls(page, key):
    return page.evaluate("k => JSON.parse(localStorage.getItem('ceh.' + k))", key)


def set_ls(page, key, value):
    page.evaluate("([k, v]) => localStorage.setItem('ceh.' + k, JSON.stringify(v))", [key, value])


def goto(page, route):
    page.goto(BASE + "#" + route)
    page.reload()  # 同一網址只換 hash 不會重新載入
    page.wait_for_selector("#app > *:not(p.muted)")


def reset(page):
    page.goto(BASE)
    page.evaluate("localStorage.clear()")
    page.reload()


def current_id(page):
    return re.search(r"\d\d-\d{3}", page.locator(".question-meta").first.inner_text()).group()


def wrong_letter(q):
    return next(k for k in q["options"] if k not in q["answer"])


def click_option(page, letter):
    page.locator(".option", has=page.locator(f".option-key:text-is('{letter}')")).first.click()


def no_h_scroll(page):
    return page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")


def test_home_theme(page):
    reset(page)
    goto(page, "/")
    check("首頁顯示四個入口", page.locator(".mode").count() == 4)
    check("首頁沒有 null 字樣", "null" not in page.locator("#app").inner_text())
    text = page.locator(".stats").inner_text()
    check("首頁題庫數為去重後 781 題", "781" in text, text)
    goto(page, "/settings")
    page.locator("input[value=dark]").check()
    check("切換深色", page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.screenshot(path=SHOTS / "settings-dark.png")
    page.reload()
    page.wait_for_selector("h1")
    check("重新整理後記住深色", page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.locator("input[value=system]").check()
    check("回到跟隨系統", page.evaluate("document.documentElement.dataset.theme") is None)


def test_study(page):
    reset(page)
    goto(page, "/study")
    page.locator("select").select_option("ceh13-04.pdf")
    page.wait_for_selector(".question")
    check("來源篩選", page.get_by_text("/ 542 題").count() == 1)
    page.locator("input[type=number]").fill("335")
    page.locator("input[type=number]").press("Enter")
    check("題號跳轉", current_id(page) == "04-335")
    check("預設隱藏答案", page.locator(".option.correct").count() == 0)
    page.get_by_role("button", name="顯示答案").click()
    check("顯示正確答案", page.locator(".option.correct").count() == 1)
    feedback = page.locator(".feedback").inner_text()
    check("顯示答案已修正與 PDF 原答案", "答案已修正" in feedback and "PDF 原答案" in feedback and "修正理由" in feedback)
    page.screenshot(path=SHOTS / "study-corrected.png", full_page=True)
    page.reload()
    page.wait_for_selector(".question")
    check("重新整理後回到同一題", current_id(page) == "04-335")
    page.keyboard.press("ArrowRight")
    check("方向鍵換題", current_id(page) == "04-336")

    page.locator("select").select_option("all")
    page.locator("input[type=search]").fill("Website Mirroring")
    page.wait_for_function("document.querySelector('.muted').textContent !== ''")
    page.wait_for_timeout(300)
    check("關鍵字搜尋", page.get_by_text(re.compile(r"第 1 / \d+ 題")).count() == 1)
    page.locator("input[type=search]").fill("xyzzy-none")
    page.wait_for_selector(".empty")
    check("搜尋無結果提示", True)
    page.locator("input[type=search]").fill("")
    page.wait_for_selector(".question")

    for qid, expect, absent in [("02-040", "答案疑義", "答案已修正"), ("04-405", None, "答案疑義"), ("02-083", "答案已修正", "答案疑義")]:
        page.locator("select").select_option(QUESTIONS[qid]["source"])
        page.wait_for_selector(".question")
        page.locator("input[type=number]").fill(str(int(qid[3:]) if qid[:2] != "02" or int(qid[3:]) < 110 else int(qid[3:]) - 1))
        page.locator("input[type=number]").press("Enter")
        page.get_by_role("button", name="顯示答案").click()
        text = page.locator(".feedback").inner_text()
        check(f"{qid} 徽章正確", (expect is None or expect in text) and absent not in text, text[:120])

    # 被合併的題目改顯示保留版本
    page.locator("select").select_option("ceh13-01.pdf")
    page.wait_for_selector(".question")
    page.locator("input[type=number]").fill("4")
    page.locator("input[type=number]").press("Enter")
    check("合併題顯示保留版本提示", page.get_by_text("04-335 重複").count() == 1)


def test_drill(page):
    reset(page)
    goto(page, "/drill")
    seen = []
    q = QUESTIONS[current_id(page)]
    seen.append(q["id"])
    click_option(page, wrong_letter(q))
    check("答錯標紅並標出正解", page.locator(".option.wrong").count() == 1 and page.locator(".option.correct").count() == 1)
    check("顯示解析", "正確答案" in page.locator(".feedback").inner_text())
    check("答錯加入錯題庫", q["id"] in ls(page, "wrong"))
    page.screenshot(path=SHOTS / "drill-wrong.png", full_page=True)
    page.reload()
    page.wait_for_selector(".question")
    check("重新整理不重複計分", ls(page, "drill")["answered"] == 1 and page.locator(".option.correct").count() == 1)
    page.keyboard.press("Enter")
    q = QUESTIONS[current_id(page)]
    seen.append(q["id"])
    letter_index = "ABCD".index(q["answer"][0])
    page.keyboard.press(str(letter_index + 1))
    check("數字鍵作答並判定", page.locator(".option.correct").count() == 1 and page.locator(".option.wrong").count() == 0)
    check("顯示正確率", "正確率 50%" in page.locator(".rate").inner_text())
    page.keyboard.press("Enter")
    check("Enter 下一題", current_id(page) not in seen)

    # 一輪不重複、不含合併題、相似題只有一題
    drill = ls(page, "drill")
    order = drill["order"]
    check("一輪不重複", len(order) == len(set(order)))
    check("一輪不含重複題", not any("duplicateOf" in QUESTIONS[i] for i in order))
    check("相似題只出一題", ("04-060" in order) + ("04-423" in order) == 1, len(order))
    check("一輪共 781 題", len(order) == 781, len(order))
    # 最後一題做完才重新洗牌
    drill["pos"] = len(order) - 1
    drill["current"] = None
    set_ls(page, "drill", drill)
    page.reload()
    page.wait_for_selector(".question")
    last = QUESTIONS[current_id(page)]
    click_option(page, last["answer"][0])
    page.get_by_role("button", name="下一題").click()
    check("整輪做完顯示結束畫面", page.get_by_text("這一輪做完了").count() == 1)
    page.get_by_role("button", name="重新洗牌").click()
    new_order = ls(page, "drill")["order"]
    check("重新洗牌", new_order != order and ls(page, "drill")["pos"] == 0)

    # 複選題要按送出（題庫目前沒有複選題，用暫改資料驗證）
    multi = dict(QUESTIONS["03-017"], multi=True, answer=["A", "C"])
    all_q = list(QUESTIONS.values())
    patched = [multi if q["id"] == "03-017" else q for q in all_q]
    page.route("**/data/questions.json", lambda route: route.fulfill(json=patched))
    set_ls(page, "drill", {"order": ["03-017", "03-018"], "pos": 0, "answered": 0, "correct": 0, "current": None})
    page.reload()
    page.wait_for_selector(".question")
    click_option(page, "A")
    check("複選題未送出前不判定", page.locator(".option.correct").count() == 0)
    click_option(page, "C")
    page.get_by_role("button", name="送出").click()
    check("複選題送出後判定", page.locator(".option.correct").count() == 2 and page.locator(".verdict.good").count() == 1)
    page.unroute("**/data/questions.json")


def test_exam(page):
    reset(page)
    goto(page, "/exam")
    page.get_by_role("button", name="開始考試").click()
    page.wait_for_selector(".question")
    exam = ls(page, "exam")
    check("抽 125 題", len(exam["ids"]) == 125 and len(set(exam["ids"])) == 125)
    check("不含重複題", not any("duplicateOf" in QUESTIONS[i] for i in exam["ids"]))
    check("相似題最多一題", ("04-060" in exam["ids"]) + ("04-423" in exam["ids"]) <= 1)
    check("限時 4 小時", exam["durationMs"] == 4 * 3600 * 1000)
    clock = page.locator(".clock").inner_text()
    check("顯示倒數", re.fullmatch(r"03:59:\d\d|04:00:00", clock), clock)

    # 作答不顯示對錯；第 1 題答錯，第 2 題答對，第 3 題標記不答
    q1 = QUESTIONS[exam["ids"][0]]
    click_option(page, wrong_letter(q1))
    check("作答中不顯示對錯", page.locator(".option.correct, .option.wrong").count() == 0 and page.locator(".feedback").inner_text() == "")
    page.keyboard.press("ArrowRight")
    q2 = QUESTIONS[exam["ids"][1]]
    page.keyboard.press(q2["answer"][0].lower())
    page.locator(".exam-main").get_by_role("button", name="下一題").click()
    page.get_by_role("button", name="標記稍後檢查").click()
    check("導覽面板狀態", page.locator(".num.answered").count() == 2 and page.locator(".num.marked").count() == 1 and page.locator(".num.current").inner_text() == "3")
    page.screenshot(path=SHOTS / "exam-desktop.png", full_page=True)
    page.locator(".num").nth(0).click()
    check("點題號跳題", page.get_by_text("第 1 / 125 題").count() == 1)
    check("回到已作答題目保留答案", page.locator(".option.selected").count() == 1)

    # 重新整理不重置計時
    started = ls(page, "exam")["startedAt"]
    page.reload()
    page.wait_for_selector(".question")
    check("重新整理後 startedAt 不變", ls(page, "exam")["startedAt"] == started)
    check("重新整理後保留作答", len(ls(page, "exam")["answers"]) == 2)
    # 把開始時間往前移 1 小時，倒數應依 startedAt 計算
    exam = ls(page, "exam")
    exam["startedAt"] -= 3600 * 1000
    set_ls(page, "exam", exam)
    page.reload()
    page.wait_for_selector(".question")
    clock = page.locator(".clock").inner_text()
    check("倒數依開始時間計算", clock.startswith("02:59") or clock == "03:00:00", clock)

    # 交卷提醒未作答
    page.get_by_role("button", name="交卷").click()
    check("交卷前提醒未作答數", page.get_by_text("還有 123 題未作答").count() == 1)
    page.screenshot(path=SHOTS / "exam-submit-dialog.png")
    page.locator("dialog").get_by_role("button", name="取消").click()
    check("取消後仍在考試", ls(page, "exam") is not None)
    page.get_by_role("button", name="交卷").click()
    page.locator("dialog").get_by_role("button", name="交卷").click()
    page.wait_for_selector(".score")
    history = ls(page, "examHistory")
    check("產生考試紀錄", len(history) == 1 and history[0]["correct"] >= 1)
    check("分數與題數", history[0]["total"] == 125 and history[0]["pct"] == round(history[0]["correct"] / 125 * 100, 1))
    check("進行中的考試已清除", ls(page, "exam") is None)
    text = page.locator(".result").inner_text()
    check("顯示答對題數與用時", "/ 125" in text and "作答時間" in text and "未及格" in text, text)
    check("顯示各分類答對率", page.locator(".bars tbody tr").count() >= 2)
    wrong = ls(page, "wrong")
    check("答錯和未作答都加入錯題庫", len(wrong) == 125 - history[0]["correct"] and q1["id"] in wrong, len(wrong))
    page.screenshot(path=SHOTS / "exam-result.png", full_page=False)
    missed_count = page.locator(".question").count()
    check("預設只看錯題", missed_count == 125 - history[0]["correct"], missed_count)
    review = page.locator(".question").first.locator(".feedback").inner_text()
    check("檢討顯示我的答案與正確答案", "我的答案" in review and "正確答案" in review, review[:80])
    page.get_by_role("button", name="全部").click()
    check("篩選全部", page.locator(".question").count() == 125)

    # 時間到自動交卷（用 page.clock 快轉）
    page.clock.install()
    goto(page, "/exam")
    page.get_by_role("button", name="開始考試").click()
    page.wait_for_selector(".question")
    page.clock.run_for(4 * 3600 * 1000 + 2000)
    page.wait_for_selector(".score")
    check("時間到自動交卷", len(ls(page, "examHistory")) == 2 and ls(page, "exam") is None)
    check("用時不超過 4 小時", ls(page, "examHistory")[1]["usedMs"] == 4 * 3600 * 1000)
    # 關閉頁面期間到期，重新開啟時交卷
    reset(page)
    goto(page, "/exam")
    page.get_by_role("button", name="開始考試").click()
    page.wait_for_selector(".question")
    exam = ls(page, "exam")
    exam["startedAt"] -= 5 * 3600 * 1000
    set_ls(page, "exam", exam)
    page.goto("about:blank")
    goto(page, "/")
    check("離開期間到期，重新開啟時已交卷", ls(page, "exam") is None and len(ls(page, "examHistory")) == 1)

    # 分數趨勢
    history = ls(page, "examHistory")
    base = history[0]
    extra = [dict(base, id=str(i), pct=p, correct=int(p * 1.25), finishedAt=base["finishedAt"] + i * 86400000) for i, p in enumerate([52, 66, 74.4], 1)]
    set_ls(page, "examHistory", history + extra)
    goto(page, "/exam/history")
    check("趨勢圖", page.locator("svg.chart .trend").count() == 1 and page.locator("svg.chart .point").count() == 4)
    page.locator("svg.chart .hit").nth(2).hover()
    check("趨勢圖 tooltip", "66%" in page.locator(".chart-tip").inner_text())
    page.screenshot(path=SHOTS / "exam-history.png", full_page=True)


def test_wrongbook(page):
    reset(page)
    goto(page, "/wrong")
    check("錯題庫空狀態", page.get_by_text("錯題庫是空的").count() == 1 and page.get_by_role("link", name="去模擬考").count() == 1)
    goto(page, "/wrong/practice")
    check("練習頁空狀態", page.get_by_text("錯題庫是空的").count() == 1)

    now = 1_700_000_000_000
    set_ls(page, "wrong", {
        "03-017": {"wrongCount": 1, "streak": 0, "lastWrongAt": now},
        "03-019": {"wrongCount": 5, "streak": 0, "lastWrongAt": now - 1},
        "03-029": {"wrongCount": 3, "streak": 0, "lastWrongAt": now - 2},
    })
    goto(page, "/wrong")
    first = page.locator(".list-item").first.inner_text()
    check("依答錯次數排序", "03-019" in first, first)
    page.locator(".list-item").first.get_by_role("button", name="移除").click()
    page.locator("dialog").get_by_role("button", name="確定").click()
    check("手動移除", "03-019" not in ls(page, "wrong"))

    set_ls(page, "wrong", {"03-017": {"wrongCount": 1, "streak": 0, "lastWrongAt": now}})
    set_ls(page, "wrongQueue", [])
    goto(page, "/wrong/practice")
    q = QUESTIONS["03-017"]
    click_option(page, q["answer"][0])
    check("答對累計連續次數", ls(page, "wrong")["03-017"]["streak"] == 1)
    page.get_by_role("button", name="下一題").click()
    click_option(page, wrong_letter(q))
    entry = ls(page, "wrong")["03-017"]
    check("答錯後連續次數歸零並累計", entry["streak"] == 0 and entry["wrongCount"] == 2, entry)
    page.get_by_role("button", name="下一題").click()
    click_option(page, q["answer"][0])
    page.get_by_role("button", name="下一題").click()
    click_option(page, q["answer"][0])
    check("連續答對 2 次移出", "03-017" not in ls(page, "wrong"))
    page.get_by_role("button", name="下一題").click()
    check("清空後顯示提示", page.get_by_text("錯題庫是空的").count() == 1)

    set_ls(page, "settings", {"removeAfter": 1})
    set_ls(page, "wrong", {"03-017": {"wrongCount": 1, "streak": 0, "lastWrongAt": now}})
    goto(page, "/wrong/practice")
    click_option(page, q["answer"][0])
    check("設定調整移出次數後生效", "03-017" not in ls(page, "wrong"))


def test_translate(page, mobile=False):
    reset(page)
    calls = []

    def fake_ok(route):
        calls.append(route.request.url)
        route.fulfill(json={"responseStatus": 200, "responseData": {"translatedText": "測試翻譯"}, "quotaFinished": False})

    page.route("**/api.mymemory.translated.net/**", fake_ok)
    select_js = """() => {
      const el = document.querySelector('.stem');
      const text = el.firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 12);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(range);
      return String(s);
    }"""
    goto(page, "/study")
    source = page.evaluate(select_js)
    if not mobile:
        page.evaluate("document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
    popup = page.locator(".translate-popup")
    popup.wait_for()
    page.get_by_text("測試翻譯").wait_for()
    check(f"選字跳出翻譯（{'手機' if mobile else '電腦'}）", True)
    check("API 使用 en|zh-TW", "langpair=en%7Czh-TW" in calls[0], calls[0])
    check("未填 email 不帶 de", "de=" not in calls[0], calls[0])
    check("有 Google 備案連結", page.get_by_role("link", name="用 Google 翻譯開啟").count() == 1)
    if mobile:
        check("手機版固定在底部", "docked" in popup.get_attribute("class"))
        page.screenshot(path=SHOTS / "translate-mobile.png")
        return
    page.screenshot(path=SHOTS / "translate-desktop.png")
    popup.get_by_role("button", name="加入生字本").click()
    check("加入生字本", ls(page, "vocab")[0]["word"] == source.strip())
    popup.get_by_role("button", name="關閉").click()
    goto(page, "/vocab")
    check("生字本列出", page.get_by_text("測試翻譯").count() == 1)
    page.screenshot(path=SHOTS / "vocab.png")
    page.get_by_role("button", name="刪除").click()
    check("刪除生字", ls(page, "vocab") == [] and page.get_by_text("還沒有生字").count() == 1)

    # 快取命中
    calls.clear()
    goto(page, "/study")
    page.evaluate(select_js)
    page.evaluate("document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
    page.get_by_text("測試翻譯").wait_for()
    check("快取命中不呼叫 API", calls == [], calls)

    # 有填 email 才帶 de
    page.evaluate("localStorage.removeItem('ceh.translations')")
    set_ls(page, "settings", {"email": "tester@example.com"})
    calls.clear()
    goto(page, "/study")
    page.evaluate(select_js)
    page.evaluate("document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
    page.get_by_text("測試翻譯").wait_for()
    check("填 email 後帶 de", "de=tester%40example.com" in calls[0], calls[0])
    page.unroute("**/api.mymemory.translated.net/**")

    # 額度用完
    page.evaluate("localStorage.removeItem('ceh.translations')")
    page.route("**/api.mymemory.translated.net/**", lambda r: r.fulfill(json={
        "responseStatus": 200, "quotaFinished": True,
        "responseData": {"translatedText": "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY."}}))
    goto(page, "/study")
    page.evaluate(select_js)
    page.evaluate("document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
    page.get_by_text("額度已用完").wait_for()
    check("額度用完提示與 Google 連結", page.get_by_role("link", name="用 Google 翻譯開啟").count() == 1)
    page.unroute("**/api.mymemory.translated.net/**")

    # API 失敗
    page.route("**/api.mymemory.translated.net/**", lambda r: r.abort())
    goto(page, "/study")
    page.evaluate(select_js)
    page.evaluate("document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
    page.get_by_text("暫時無法使用").wait_for()
    check("API 失敗提供 Google 連結", page.get_by_role("link", name="用 Google 翻譯開啟").count() == 1)
    page.unroute("**/api.mymemory.translated.net/**")

    # 真實 API
    page.evaluate("localStorage.removeItem('ceh.translations'); localStorage.removeItem('ceh.settings')")
    goto(page, "/study")
    page.evaluate(select_js)
    page.evaluate("document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))")
    page.locator(".translate-result").wait_for()
    page.wait_for_function("document.querySelector('.translate-result').textContent !== '翻譯中…'", timeout=20000)
    real = page.locator(".translate-result").inner_text()
    print(f"INFO  真實 MyMemory：{source!r} -> {real}")
    check("真實 API 回傳翻譯", real not in ("無法取得翻譯", "翻譯中…") and bool(real), real)

    # 選字時點選項不算作答（刷題）
    set_ls(page, "drill", None)
    page.evaluate("localStorage.removeItem('ceh.drill')")
    goto(page, "/drill")
    box = page.locator(".option-text").first.bounding_box()
    page.mouse.move(box["x"] + 1, box["y"] + 8)
    page.mouse.down()
    page.mouse.move(box["x"] + 60, box["y"] + 8, steps=4)
    page.mouse.up()
    check("拖曳選字不算作答", page.locator(".option.correct").count() == 0 and len(page.evaluate("String(getSelection())")) > 0)


def test_settings(page):
    reset(page)
    set_ls(page, "wrong", {"03-017": {"wrongCount": 4, "streak": 0, "lastWrongAt": 1}})
    set_ls(page, "vocab", [{"word": "spoof", "translation": "偽造", "addedAt": 1}])
    goto(page, "/settings")
    page.locator("input[name=passPct]").fill("80")
    page.locator("input[name=passPct]").blur()
    check("及格門檻儲存", ls(page, "settings")["passPct"] == 80)
    page.locator("input[name=passPct]").fill("999")
    page.locator("input[name=passPct]").blur()
    check("及格門檻限制範圍", ls(page, "settings")["passPct"] == 100)
    page.locator("input[type=email]").fill("a@b.co")
    page.locator("input[type=email]").blur()
    check("email 儲存", ls(page, "settings")["email"] == "a@b.co")

    with page.expect_download() as info:
        page.get_by_role("button", name="匯出作答紀錄").click()
    path = info.value.path()
    exported = json.loads(Path(path).read_text("utf-8"))
    check("匯出內容", exported["data"]["wrong"]["03-017"]["wrongCount"] == 4 and exported["data"]["vocab"][0]["word"] == "spoof")

    # 二次確認
    page.get_by_role("button", name="清除所有紀錄").click()
    page.locator("dialog").get_by_role("button", name="繼續").click()
    check("清除有第二次確認", page.get_by_text("最後確認").count() == 1 and ls(page, "wrong") is not None)
    page.locator("dialog").get_by_role("button", name="清除所有紀錄").click()
    check("清除所有紀錄", ls(page, "wrong") is None and ls(page, "vocab") is None)

    # 匯入還原
    page.locator("input[type=file]").set_input_files(str(path))
    page.locator("dialog").get_by_role("button", name="匯入").click()
    page.get_by_text("匯入完成").wait_for()
    check("匯入還原", ls(page, "wrong")["03-017"]["wrongCount"] == 4 and ls(page, "vocab")[0]["word"] == "spoof")
    # 壞檔案不影響資料
    page.locator("input[type=file]").set_input_files({"name": "bad.json", "mimeType": "application/json", "buffer": b'{"foo":1}'})
    page.locator("dialog").get_by_role("button", name="匯入").click()
    page.get_by_text("匯入失敗").wait_for()
    check("匯入錯誤檔案不影響資料", ls(page, "wrong")["03-017"]["wrongCount"] == 4)


def test_unlock(browser):
    sys.path.insert(0, str(ROOT / "scripts"))
    import encrypt_data

    password = "test-password-1234"
    try:
        encrypt_data.encrypt(b"{}", "short")
        check("少於 12 字元拒絕加密", False)
    except ValueError:
        check("少於 12 字元拒絕加密", True)
    payload = encrypt_data.encrypt(encrypt_data.build_plaintext(), password)
    check("密文使用隨機 salt 與 IV", payload["salt"] != encrypt_data.encrypt(b"{}", password)["salt"])
    check("迭代至少 600,000 次", payload["iterations"] >= 600_000)
    check("密碼比對", encrypt_data.password_matches(payload, password) and not encrypt_data.password_matches(payload, "wrong-password-1234"))

    def locked_context(**kwargs):
        context = browser.new_context(accept_downloads=True, **kwargs)
        # 模擬 GitHub Pages：沒有明文，只有密文
        context.route("**/data/questions.json", lambda r: r.fulfill(status=404))
        context.route("**/data/explanations_ai.json", lambda r: r.fulfill(status=404))
        context.route("**/data/questions.enc.json", lambda r: r.fulfill(json=payload))
        return context

    context = locked_context(viewport={"width": 1280, "height": 860})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_selector("input[type=password]")
    check("沒有明文時顯示解鎖畫面", page.get_by_text("解鎖題庫").count() >= 1 and not page.locator(".topnav").is_visible())
    page.locator("input[type=password]").fill("wrong-password-1234")
    page.get_by_role("button", name="解鎖").click()
    page.get_by_text("密碼錯誤，請再試一次。").wait_for(timeout=20000)
    check("密碼錯誤有明確提示", page.get_by_role("alert").inner_text() == "密碼錯誤，請再試一次。")
    page.locator("input[type=password]").fill(password)
    page.get_by_role("button", name="解鎖").click()
    page.wait_for_selector(".stats", timeout=20000)
    check("解鎖後載入 781 題", "781" in page.locator(".stats").inner_text())
    check("解鎖後含 AI 解析", page.evaluate("import('./js/data.js').then(m => Boolean(m.allQuestions().find(q => q.aiExplanation)))"))
    check("沒勾選不記住密碼", page.evaluate("localStorage.getItem('ceh-unlock-password')") is None)
    page.reload()
    page.wait_for_selector("input[type=password]")
    page.locator("input[type=password]").fill(password)
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="解鎖").click()
    page.wait_for_selector(".stats", timeout=20000)
    check("勾選後記住密碼", page.evaluate("localStorage.getItem('ceh-unlock-password')") == password)
    page.reload()
    page.wait_for_selector(".stats", timeout=20000)
    check("記住後自動解鎖", page.locator(".topnav").is_visible())
    page.goto(BASE + "#/settings")
    page.wait_for_selector("h1")
    with page.expect_download() as info:
        page.get_by_role("button", name="匯出作答紀錄").click()
    check("匯出檔不含密碼", password not in Path(info.value.path()).read_text("utf-8"))
    page.get_by_role("button", name="清除記住的密碼").click()
    check("設定頁可清除密碼", page.evaluate("localStorage.getItem('ceh-unlock-password')") is None and page.get_by_text("已清除記住的密碼").count() == 1)
    page.evaluate("localStorage.setItem('ceh-unlock-password', 'stale-password-1234')")
    page.reload()
    page.get_by_text("記住的密碼已失效").wait_for(timeout=20000)
    check("失效的密碼會被清除", page.evaluate("localStorage.getItem('ceh-unlock-password')") is None)
    check("解鎖流程沒有 JS 錯誤", not errors, errors)
    context.close()

    context = locked_context()
    context.add_init_script("Object.defineProperty(crypto, 'subtle', { value: undefined })")
    page = context.new_page()
    page.goto(BASE)
    page.get_by_text("沒有提供 Web Crypto").wait_for()
    check("沒有 Web Crypto 時顯示說明", True)
    context.close()

    # 區網 IP 沒有 Web Crypto，但有明文題庫時不需要解密
    context = browser.new_context()
    context.add_init_script("Object.defineProperty(crypto, 'subtle', { value: undefined })")
    page = context.new_page()
    page.goto(BASE)
    page.wait_for_selector(".stats")
    check("有明文時略過解密", page.locator("input[type=password]").count() == 0)
    context.close()


def test_mobile(browser):
    context = browser.new_context(viewport={"width": 375, "height": 720}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    reset(page)

    for route, name in [("/", "home"), ("/study", "study"), ("/drill", "drill"), ("/wrong", "wrong"), ("/vocab", "vocab"), ("/settings", "settings")]:
        goto(page, route)
        check(f"375px 無橫向捲動：{name}", no_h_scroll(page))
        page.screenshot(path=SHOTS / f"mobile-{name}.png", full_page=True)

    goto(page, "/drill")
    sizes = page.evaluate("[...document.querySelectorAll('.option')].map(e => e.getBoundingClientRect().height)")
    check("選項點擊區至少 44px", min(sizes) >= 44, sizes)
    q = QUESTIONS[current_id(page)]
    page.locator(".option", has=page.locator(f".option-key:text-is('{wrong_letter(q)}')")).first.tap()
    check("手機點選作答", page.locator(".option.wrong").count() == 1)
    page.screenshot(path=SHOTS / "mobile-drill-answered.png", full_page=True)

    goto(page, "/exam")
    page.get_by_role("button", name="開始考試").tap()
    page.wait_for_selector(".question")
    check("375px 無橫向捲動：exam", no_h_scroll(page))
    page.screenshot(path=SHOTS / "mobile-exam.png")
    check("手機面板預設收起", not page.locator(".exam-panel").is_visible())
    page.get_by_role("button", name="題號").tap()
    check("手機面板可開啟", page.locator(".exam-panel").is_visible())
    bar = page.locator(".exam-bar").bounding_box()
    check("手機面板不蓋住交卷列", page.locator(".exam-panel").bounding_box()["y"] >= bar["y"] + bar["height"])
    page.screenshot(path=SHOTS / "mobile-exam-panel.png")
    page.locator(".num").nth(4).tap()
    check("手機跳題", page.get_by_text("第 5 / 125 題").count() == 1)
    small = page.evaluate("""[...document.querySelectorAll('.btn, .num, .option')]
        .filter(e => e.offsetParent).map(e => e.getBoundingClientRect().height).filter(h => h < 40)""")
    check("按鈕高度至少 40px", not small, small)
    page.get_by_role("button", name="交卷").tap()
    page.locator("dialog").get_by_role("button", name="交卷").tap()
    page.wait_for_selector(".score")
    check("375px 無橫向捲動：result", no_h_scroll(page))
    page.screenshot(path=SHOTS / "mobile-result.png", full_page=False)
    goto(page, "/exam/history")
    check("375px 無橫向捲動：history", no_h_scroll(page))

    test_translate(page, mobile=True)
    check("手機版沒有 JS 錯誤", not errors, errors)
    context.close()


def main():
    SHOTS.mkdir(exist_ok=True)
    server = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        context = browser.new_context(viewport={"width": 1280, "height": 860}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        for test in (test_home_theme, test_study, test_drill, test_exam, test_wrongbook, test_translate, test_settings):
            try:
                test(page)
            except Exception as err:  # 單一區塊失敗時仍跑完其他區塊
                check(f"{test.__name__} 例外", False, str(err)[:500])
        check("電腦版沒有 JS 錯誤", not errors, errors)
        context.close()
        try:
            test_unlock(browser)
        except Exception as err:
            check("test_unlock 例外", False, str(err)[:500])
        try:
            test_mobile(browser)
        except Exception as err:
            check("test_mobile 例外", False, str(err)[:500])
        browser.close()
    server.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} / {len(results)} 通過")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
