import unittest
import os
import sys
import unittest.mock

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

    def test_image_conversion_graceful_routing(self):
        res = convert_bytes("test.png", b"invalid image data")
        self.assertTrue(res["success"])
        self.assertTrue(
            res["markdown"].startswith("## Image Processing Error") or 
            res["markdown"].startswith("## Dependency Error")
        )

    def test_audio_conversion_graceful_routing(self):
        res = convert_bytes("test.mp3", b"invalid mp3 data")
        self.assertTrue(res["success"])
        self.assertTrue(
            res["markdown"].startswith("## Dependency Error") or
            res["markdown"].startswith("## FFmpeg Error") or
            res["markdown"].startswith("## Audio Conversion Error")
        )

    @unittest.mock.patch("media_handlers.subprocess.run")
    def test_audio_conversion_chunk_and_stitch(self, mock_subprocess_run):
        # Create dummy chunk files out-of-order to verify chronological sorting
        def side_effect(*args, **kwargs):
            cwd = kwargs.get("cwd")
            if cwd:
                with open(os.path.join(cwd, "temp_chunk_001.wav"), "w") as f:
                    f.write("mock 1")
                with open(os.path.join(cwd, "temp_chunk_000.wav"), "w") as f:
                    f.write("mock 0")
        mock_subprocess_run.side_effect = side_effect

        mock_whisper = unittest.mock.MagicMock()
        mock_model = unittest.mock.MagicMock()
        def transcribe_side_effect(path, **kwargs):
            if "temp_chunk_000" in path:
                return {"text": "hello world"}
            elif "temp_chunk_001" in path:
                return {"text": "foo bar"}
            return {"text": ""}
        mock_model.transcribe.side_effect = transcribe_side_effect
        mock_whisper.load_model.return_value = mock_model

        with unittest.mock.patch.dict("sys.modules", {"whisper": mock_whisper}):
            res = convert_bytes("test.mp4", b"dummy video content")

        self.assertTrue(res["success"])
        self.assertIn("### Minute 1", res["markdown"])
        self.assertIn("### Minute 2", res["markdown"])
        self.assertIn("> hello world", res["markdown"])
        self.assertIn("> foo bar", res["markdown"])

    def test_path_conversion(self):
        from converter import convert_file_at_path
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".txt")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write("Hello path conversion!")
            res = convert_file_at_path(path)
            self.assertTrue(res["success"])
            self.assertEqual(res["markdown"], "Hello path conversion!")
        finally:
            if os.path.exists(path):
                os.remove(path)

if __name__ == "__main__":
    unittest.main()


