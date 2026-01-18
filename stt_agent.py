import logging
import json
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    RoomOutputOptions,
    StopResponse,
    WorkerOptions,
    cli,
    llm,
)
from livekit.plugins import assemblyai

load_dotenv()

logger = logging.getLogger("transcriber")

# Create transcripts directory if it doesn't exist
TRANSCRIPTS_DIR = Path("transcripts")
TRANSCRIPTS_DIR.mkdir(exist_ok=True)

# File to store transcriptions (one JSON object per line)
TRANSCRIPTS_FILE = TRANSCRIPTS_DIR / "transcriptions.jsonl"

class Transcriber(Agent):
    def __init__(self):
        super().__init__(
            instructions="not-needed",
            stt=assemblyai.STT(),
        )

    async def on_user_turn_completed(self, chat_ctx: llm.ChatContext, new_message: llm.ChatMessage):
        # Add any backend processing of transcripts here if needed
        user_transcript = new_message.text_content
        logger.info(f" -> {user_transcript}")

        # Write transcription to file
        transcription_entry = {
            "timestamp": datetime.now().isoformat(),
            "text": user_transcript,
            "source": "assemblyai"
        }
        
        # Append to JSONL file (one JSON object per line)
        with open(TRANSCRIPTS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(transcription_entry) + "\n")
        
        logger.info(f"Transcription saved to {TRANSCRIPTS_FILE}")

        # Needed to stop the agent's default conversational loop
        raise StopResponse()


async def entrypoint(ctx: JobContext):
    logger.info(f"starting transcriber (speech to text) example, room: {ctx.room.name}")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    session = AgentSession()

    await session.start(
        agent=Transcriber(),
        room=ctx.room,
        room_output_options=RoomOutputOptions(
            # If you don't want to send the transcription back to the room, set this to False
            transcription_enabled=True,
            audio_enabled=False,
        ),
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))