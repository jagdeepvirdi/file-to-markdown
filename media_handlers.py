"""
media_handlers.py
-----------------
Offline processing module for images (OCR via Tesseract) and audio/video
(transcription via FFmpeg downmixing and PocketSphinx).
"""

import os
import signal
import subprocess
import tempfile
import sys
import glob
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed


def process_image(file_path: str) -> str:
    """
    Open the image via Pillow and extract text layout natively via pytesseract.
    Returns standard Markdown format.
    """
    try:
        from PIL import Image
        import pytesseract
    except ImportError:
        instruction = (
            "## Dependency Error\n\n"
            "**Required Python packages are missing.**\n\n"
            "Please install the required libraries in your environment:\n"
            "```bash\n"
            "pip install pytesseract pillow\n"
            "```"
        )
        print(instruction)
        return instruction

    try:
        # If running as a PyInstaller packaged app, try to locate bundled tesseract on Windows
        if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
            possible_path = os.path.join(sys._MEIPASS, "tesseract", "tesseract.exe")
            if os.path.exists(possible_path):
                pytesseract.pytesseract.tesseract_cmd = possible_path

        with Image.open(file_path) as img:
            text = pytesseract.image_to_string(img)
        
        paragraphs = []
        for p in text.split("\n\n"):
            cleaned = p.strip()
            if cleaned:
                lines = [line.strip() for line in cleaned.split("\n")]
                paragraphs.append(" ".join(lines))
        
        if not paragraphs:
            return "## Image Analysis\n\nNo text content was detected in this image."
            
        md_text = "\n\n".join(paragraphs)
        return f"## Image Transcription\n\n{md_text}"

    except (FileNotFoundError, pytesseract.TesseractNotFoundError):
        instruction = (
            "## Dependency Error\n\n"
            "**Tesseract OCR is not installed or not in your system PATH.**\n\n"
            "To transcribe text from images, please install Tesseract OCR:\n\n"
            "### Windows:\n"
            "1. Run this command in PowerShell:\n"
            "   ```powershell\n"
            "   winget install UB-Mannheim.TesseractOCR\n"
            "   ```\n"
            "2. Restart your terminal or system so the environment variables update.\n"
            "3. If it still fails, ensure the folder `C:\\Program Files\\Tesseract-OCR` is added to your system PATH.\n\n"
            "### macOS:\n"
            "Run this command in Terminal:\n"
            "```bash\n"
            "brew install tesseract\n"
            "```\n\n"
            "### Linux:\n"
            "Run this command:\n"
            "```bash\n"
            "sudo apt install tesseract-ocr\n"
            "```"
        )
        print(instruction)
        return instruction
    except Exception as e:
        err_msg = f"## Image Processing Error\n\nAn unexpected error occurred: {str(e)}"
        print(err_msg)
        return err_msg


def process_audio_video(file_path: str, progress_callback=None) -> str:
    """
    Extract/downmix video or audio to mono 16kHz WAV via FFmpeg in 60-second chunks,
    then transcribe chunks in parallel using pocketsphinx.AudioFile.

    progress_callback(stage, completed, total) is called:
      - ("preparing", 0, 0)   while FFmpeg is running
      - ("transcribing", n, total) after each chunk finishes
    """
    try:
        from pocketsphinx import AudioFile
    except ImportError:
        instruction = (
            "## Dependency Error\n\n"
            "**Required Python packages are missing.**\n\n"
            "Please install pocketsphinx in your environment:\n"
            "```bash\n"
            "pip install pocketsphinx\n"
            "```"
        )
        print(instruction)
        return instruction

    temp_dir = tempfile.mkdtemp()

    try:
        if progress_callback:
            progress_callback("preparing", 0, 0)

        # Run ffmpeg to segment/downmix into 60-second PCM WAV chunks
        cmd = [
            "ffmpeg",
            "-y",
            "-i", os.path.abspath(file_path),
            "-f", "segment",
            "-segment_time", "60",
            "-c:a", "pcm_s16le",
            "-ac", "1",
            "-ar", "16000",
            "temp_chunk_%03d.wav"
        ]

        try:
            subprocess.run(cmd, cwd=temp_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        except FileNotFoundError:
            instruction = (
                "## Dependency Error\n\n"
                "**FFmpeg is not installed or not in your system PATH.**\n\n"
                "To convert audio/video files offline, please install FFmpeg:\n\n"
                "### Windows:\n"
                "Run this command in PowerShell:\n"
                "```powershell\n"
                "winget install Gyan.FFmpeg\n"
                "```\n\n"
                "### macOS:\n"
                "Run this command in Terminal:\n"
                "```bash\n"
                "brew install ffmpeg\n"
                "```\n\n"
                "### Linux:\n"
                "Run this command:\n"
                "```bash\n"
                "sudo apt install ffmpeg\n"
                "```"
            )
            print(instruction)
            return instruction
        except subprocess.CalledProcessError as e:
            err_msg = (
                f"## FFmpeg Error\n\n"
                f"FFmpeg failed to convert media (Exit code: {e.returncode}).\n\n"
                f"Error log details:\n"
                f"```\n{e.stderr.decode('utf-8', errors='ignore')}\n```"
            )
            print(err_msg)
            return err_msg
        except Exception as e:
            err_msg = f"## Audio Conversion Error\n\nAn unexpected error occurred during audio prep: {str(e)}"
            print(err_msg)
            return err_msg

        # Transcribe the chunks
        try:
            chunk_pattern = os.path.join(temp_dir, "temp_chunk_*.wav")
            chunk_files = glob.glob(chunk_pattern)
            chunk_files.sort()

            if not chunk_files:
                return "## Audio/Video Transcript\n\n*No speech detected or transcribed.*"

            total = len(chunk_files)
            if progress_callback:
                progress_callback("transcribing", 0, total)

            def _transcribe_one(args):
                idx, path = args
                segs = []
                for phrase in AudioFile(path):
                    txt = str(phrase).strip()
                    if txt:
                        segs.append(txt)
                return idx, segs

            # PocketSphinx calls signal.signal() internally, which raises
            # "signal only works in main thread" when called from a daemon thread.
            # Patch once before spawning workers; restore in finally regardless of outcome.
            _orig_signal = signal.signal

            def _thread_safe_signal(sig, handler):
                if threading.current_thread() is threading.main_thread():
                    return _orig_signal(sig, handler)

            signal.signal = _thread_safe_signal
            results = {}
            completed = 0
            max_workers = min(os.cpu_count() or 2, total, 4)

            try:
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = {
                        executor.submit(_transcribe_one, (i, f)): i
                        for i, f in enumerate(chunk_files)
                    }
                    for future in as_completed(futures):
                        try:
                            idx, segs = future.result()
                            results[idx] = segs
                        except Exception:
                            results[futures[future]] = []
                        completed += 1
                        if progress_callback:
                            progress_callback("transcribing", completed, total)
            finally:
                signal.signal = _orig_signal

            # Assemble transcript in strict chronological order
            transcript_parts = []
            for index in sorted(results.keys()):
                segments = results[index]
                if segments:
                    paragraphs = []
                    current_para = []
                    for seg in segments:
                        current_para.append(seg)
                        if len(current_para) >= 5 or seg.endswith(('.', '?', '!')):
                            paragraphs.append("> " + " ".join(current_para))
                            current_para = []
                    if current_para:
                        paragraphs.append("> " + " ".join(current_para))
                    chunk_md = "\n>\n".join(paragraphs)
                    transcript_parts.append(f"### Minute {index + 1}\n\n{chunk_md}")

            if not transcript_parts:
                return "## Audio/Video Transcript\n\n*No speech detected or transcribed.*"

            md_text = "\n\n".join(transcript_parts)
            return f"## Audio/Video Transcript\n\n{md_text}"

        except Exception as e:
            err_msg = f"## Transcription Error\n\nAn error occurred during decoding: {str(e)}"
            print(err_msg)
            return err_msg

    finally:
        try:
            chunks = glob.glob(os.path.join(temp_dir, "temp_chunk_*.wav"))
            for chunk_file in chunks:
                if os.path.exists(chunk_file):
                    try:
                        os.remove(chunk_file)
                    except OSError:
                        pass
        except Exception:
            pass

        try:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
        except OSError:
            pass
