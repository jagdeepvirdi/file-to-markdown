"""
media_handlers.py
-----------------
Offline processing module for images (OCR via Tesseract) and audio/video
(transcription via FFmpeg downmixing and OpenAI Whisper).
"""

import os
import subprocess
import tempfile
import sys
import glob
import shutil


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
    then transcribe each chunk sequentially using OpenAI Whisper (offline).

    progress_callback(stage, completed, total) is called:
      - ("preparing", 0, 0)     while FFmpeg is running
      - ("transcribing", n, total) after each chunk finishes
    """
    try:
        import whisper
    except ImportError:
        instruction = (
            "## Dependency Error\n\n"
            "**Required Python package is missing.**\n\n"
            "Please install openai-whisper in your environment:\n"
            "```bash\n"
            "pip install openai-whisper\n"
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

        with tempfile.TemporaryFile() as _stderr_tmp:
            try:
                subprocess.run(cmd, cwd=temp_dir, stdout=subprocess.DEVNULL, stderr=_stderr_tmp, check=True)
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
                _stderr_tmp.seek(0)
                stderr_text = _stderr_tmp.read().decode("utf-8", errors="ignore")
                err_msg = (
                    f"## FFmpeg Error\n\n"
                    f"FFmpeg failed to convert media (Exit code: {e.returncode}).\n\n"
                    f"Error log details:\n"
                    f"```\n{stderr_text}\n```"
                )
                print(err_msg)
                return err_msg
            except Exception as e:
                err_msg = f"## Audio Conversion Error\n\nAn unexpected error occurred during audio prep: {str(e)}"
                print(err_msg)
                return err_msg

        chunk_files = sorted(glob.glob(os.path.join(temp_dir, "temp_chunk_*.wav")))

        if not chunk_files:
            return "## Audio/Video Transcript\n\n*No audio track found or file contains no audio.*"

        total = len(chunk_files)
        if progress_callback:
            progress_callback("transcribing", 0, total)

        try:
            # Load the model once; "base" (~290 MB) balances accuracy and CPU speed.
            # fp16=False avoids a warning on CPU-only machines (Whisper defaults to fp16 for GPU).
            model = whisper.load_model("base")
            transcript_parts = []
            for i, chunk_path in enumerate(chunk_files):
                result = model.transcribe(chunk_path, fp16=False)
                text = result["text"].strip()
                if text:
                    transcript_parts.append(f"### Minute {i + 1}\n\n> {text}")
                if progress_callback:
                    progress_callback("transcribing", i + 1, total)

            if not transcript_parts:
                return "## Audio/Video Transcript\n\n*No speech detected or transcribed.*"

            return "## Audio/Video Transcript\n\n" + "\n\n".join(transcript_parts)

        except Exception as e:
            err_msg = f"## Transcription Error\n\nAn error occurred during transcription: {str(e)}"
            print(err_msg)
            return err_msg

    finally:
        try:
            shutil.rmtree(temp_dir)
        except OSError:
            pass
