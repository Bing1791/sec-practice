#!/usr/bin/env python3
"""把明文題庫加密成 data/questions.enc.json，只有這份密文會進 repo。

用法：python scripts/encrypt_data.py [--if-changed]
--if-changed：明文沒有比密文新就略過，不詢問密碼（deploy.bat 使用）。
需要：pip install cryptography
"""
import base64
import getpass
import hashlib
import json
import os
import sys
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "data/questions.json"
EXPLANATIONS = ROOT / "data/explanations_ai.json"
OUTPUT = ROOT / "data/questions.enc.json"

MIN_PASSWORD_LENGTH = 12
ITERATIONS = 600_000


def derive_key(password, salt, iterations):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)


def encrypt(plaintext, password):
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"密碼至少要 {MIN_PASSWORD_LENGTH} 個字元。")
    salt = os.urandom(16)
    iv = os.urandom(12)
    ciphertext = AESGCM(derive_key(password, salt, ITERATIONS)).encrypt(iv, plaintext, None)
    encode = lambda raw: base64.b64encode(raw).decode("ascii")
    return {"v": 1, "iterations": ITERATIONS, "salt": encode(salt), "iv": encode(iv), "ciphertext": encode(ciphertext)}


def password_matches(payload, password):
    key = derive_key(password, base64.b64decode(payload["salt"]), payload["iterations"])
    try:
        AESGCM(key).decrypt(base64.b64decode(payload["iv"]), base64.b64decode(payload["ciphertext"]), None)
    except InvalidTag:
        return False
    return True


def build_plaintext():
    bundle = {
        "questions": json.loads(QUESTIONS.read_text("utf-8")),
        "ai": json.loads(EXPLANATIONS.read_text("utf-8")),
    }
    return json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def is_up_to_date():
    if not OUTPUT.exists():
        return False
    return OUTPUT.stat().st_mtime >= max(QUESTIONS.stat().st_mtime, EXPLANATIONS.stat().st_mtime)


def ask_password():
    password = getpass.getpass("題庫密碼（至少 12 字元）：")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"已拒絕：密碼少於 {MIN_PASSWORD_LENGTH} 個字元，沒有產生檔案。")
    if getpass.getpass("再輸入一次：") != password:
        sys.exit("已拒絕：兩次輸入不同，沒有產生檔案。")
    return password


def main():
    if "--if-changed" in sys.argv[1:] and is_up_to_date():
        print("題庫沒有更新，略過加密。")
        return
    password = ask_password()
    if OUTPUT.exists() and not password_matches(json.loads(OUTPUT.read_text("utf-8")), password):
        print("注意：這個密碼和現有密文不同，已記住舊密碼的裝置要重新輸入。")
        if input("確定要改用新密碼嗎？(y/N) ").strip().lower() != "y":
            sys.exit("已取消，沒有變更檔案。")
    OUTPUT.write_text(json.dumps(encrypt(build_plaintext(), password)), "utf-8")
    print(f"已產生 {OUTPUT.relative_to(ROOT).as_posix()}（{OUTPUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
