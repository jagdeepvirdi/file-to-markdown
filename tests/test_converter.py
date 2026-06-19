import unittest
import os
import sys

# Ensure parent directory is in the path so we can import converter
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from converter import convert_bytes

class TestConverter(unittest.TestCase):
    def test_text_conversion(self):
        res = convert_bytes("hello.txt", b"Hello offline world!")
        self.assertTrue(res["success"])
        self.assertEqual(res["markdown"], "Hello offline world!")

    def test_unsupported_extension(self):
        res = convert_bytes("malicious.exe", b"\x00\x00\x00")
        self.assertFalse(res["success"])
        self.assertIn("Unsupported file type", res["error"])

    def test_empty_file(self):
        res = convert_bytes("empty.txt", b"")
        self.assertFalse(res["success"])
        self.assertIn("empty", res["error"].lower())

if __name__ == "__main__":
    unittest.main()
