"""
build.py
--------
Packages the app into a single standalone desktop binary with PyInstaller.

Usage:
    pip install -r requirements.txt
    python build.py

Output:
    dist/FileToMarkdown(.exe on Windows) / dist/FileToMarkdown.app on macOS

Run this ON the target OS (Windows -> .exe, macOS -> .app, Linux -> ELF
binary). PyInstaller does not cross-compile.
"""

import os
import platform
import sys

import PyInstaller.__main__

HERE = os.path.dirname(os.path.abspath(__file__))
SEP = ";" if platform.system() == "Windows" else ":"

args = [
    "app.py",
    "--name=FileToMarkdown",
    "--onefile",
    "--windowed",  # no console window
    f"--add-data=frontend{SEP}frontend",
    # markitdown's mime sniffer (magika) and a few converters ship
    # data/model files that PyInstaller's static analysis won't find
    # on its own -- pull them in wholesale to be safe.
    "--collect-all=magika",
    "--collect-all=markitdown",
    "--collect-data=charset_normalizer",
    "--hidden-import=pyperclip",
    "--hidden-import=mammoth",
    "--hidden-import=openpyxl",
    "--hidden-import=xlrd",
    "--hidden-import=olefile",
    "--hidden-import=pdfminer",
    "--hidden-import=pdfplumber",
    "--hidden-import=pptx",
    "--clean",
    "--noconfirm",
]

if platform.system() == "Windows":
    icon = os.path.join(HERE, "icon.ico")
    if os.path.exists(icon):
        args.append(f"--icon={icon}")
elif platform.system() == "Darwin":
    icon = os.path.join(HERE, "icon.icns")
    if os.path.exists(icon):
        args.append(f"--icon={icon}")

if __name__ == "__main__":
    print(f"Building for {platform.system()} ...")
    PyInstaller.__main__.run(args)
    print("\nDone. Find your binary in the 'dist' folder.")
