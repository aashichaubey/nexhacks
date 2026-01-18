#!/usr/bin/env python3
"""
Script to interpret transcriptions using Gemini API.
Reads transcriptions from transcripts/transcriptions.jsonl and sends them to Gemini for analysis.
Saves interpretations to transcripts/interpretations.jsonl
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

# Try to load dotenv, but fall back to manual .env reading if not available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # Fallback: manually read .env file
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text().split("\n"):
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ[key.strip()] = value.strip()

TRANSCRIPTS_FILE = Path("transcripts/transcriptions.jsonl")
INTERPRETATIONS_FILE = Path("transcripts/interpretations.jsonl")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_MODEL = "gemini-pro"

def load_transcriptions() -> List[Dict]:
    """Load transcriptions from JSONL file."""
    if not TRANSCRIPTS_FILE.exists():
        print(f"No transcriptions file found at {TRANSCRIPTS_FILE}")
        return []
    
    transcriptions = []
    with open(TRANSCRIPTS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                transcriptions.append(entry)
            except json.JSONDecodeError as e:
                print(f"Error parsing line: {e}")
                continue
    
    return transcriptions

def load_processed_ids() -> set:
    """Load IDs of transcriptions that have already been processed."""
    if not INTERPRETATIONS_FILE.exists():
        return set()
    
    processed = set()
    with open(INTERPRETATIONS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                if "transcription_id" in entry:
                    processed.add(entry["transcription_id"])
            except json.JSONDecodeError:
                continue
    
    return processed

def interpret_with_gemini(text: str, transcription_id: str) -> Optional[Dict]:
    """Send transcription to Gemini API for interpretation."""
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not found in environment variables")
        print("Set it with: export GEMINI_API_KEY='your-key-here'")
        print("Or add it to a .env file")
        return None
    
    prompt = f"""Analyze this transcription/commentary and provide insights:

Transcription: "{text}"

Provide a JSON analysis with the following structure:
{{
  "summary": "Brief summary of what was said",
  "keyEvents": ["list of important events mentioned"],
  "sentiment": "positive/negative/neutral",
  "keywords": ["relevant keywords extracted"],
  "bettingRelevant": true/false,
  "insights": "Any betting or market-relevant insights",
  "confidence": "high/medium/low"
}}

Only return valid JSON, no additional text."""

    try:
        import requests
        
        url = f"{GEMINI_BASE}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        
        response = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.4,
                    "maxOutputTokens": 500
                }
            },
            timeout=30
        )
        
        if not response.ok:
            print(f"Gemini API error: {response.status_code} - {response.text}")
            return None
        
        data = response.json()
        analysis_text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        
        if not analysis_text:
            print(f"No response from Gemini for transcription {transcription_id}")
            return None
        
        # Try to parse JSON from response
        try:
            # Remove markdown code blocks if present
            if "```json" in analysis_text:
                analysis_text = analysis_text.split("```json")[1].split("```")[0].strip()
            elif "```" in analysis_text:
                analysis_text = analysis_text.split("```")[1].split("```")[0].strip()
            
            interpretation = json.loads(analysis_text)
        except json.JSONDecodeError as e:
            # If JSON parsing fails, create a structured response from raw text
            print(f"Warning: Could not parse JSON from Gemini response: {e}")
            print(f"Raw response: {analysis_text[:200]}...")
            interpretation = {
                "summary": analysis_text[:200],
                "raw": analysis_text,
                "keyEvents": [],
                "sentiment": "neutral",
                "keywords": [],
                "bettingRelevant": False,
                "insights": "",
                "confidence": "medium"
            }
        
        return interpretation
        
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return None

def save_interpretation(transcription: Dict, interpretation: Dict):
    """Save interpretation to JSONL file."""
    INTERPRETATIONS_FILE.parent.mkdir(exist_ok=True)
    
    entry = {
        "transcription_id": transcription.get("id", transcription.get("timestamp", "")),
        "timestamp": datetime.now().isoformat(),
        "original_transcription": {
            "timestamp": transcription.get("timestamp"),
            "text": transcription.get("text"),
            "source": transcription.get("source", "unknown")
        },
        "interpretation": interpretation
    }
    
    with open(INTERPRETATIONS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")

def process_transcriptions(limit: Optional[int] = None, unprocessed_only: bool = True):
    """Process transcriptions with Gemini API."""
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY environment variable not set")
        print("\nTo set it:")
        print("  1. Export in terminal: export GEMINI_API_KEY='your-key'")
        print("  2. Or add to .env file: GEMINI_API_KEY=your-key")
        return
    
    transcriptions = load_transcriptions()
    if not transcriptions:
        print("No transcriptions found to process.")
        return
    
    processed_ids = load_processed_ids() if unprocessed_only else set()
    
    # Filter out already processed transcriptions
    if unprocessed_only:
        transcriptions = [
            t for t in transcriptions 
            if t.get("id", t.get("timestamp", "")) not in processed_ids
        ]
    
    if not transcriptions:
        print("All transcriptions have already been processed.")
        return
    
    # Apply limit if specified
    if limit:
        transcriptions = transcriptions[-limit:]  # Process most recent N
    
    print(f"Processing {len(transcriptions)} transcription(s)...")
    
    for i, transcription in enumerate(transcriptions, 1):
        transcription_id = transcription.get("id", transcription.get("timestamp", ""))
        text = transcription.get("text", "")
        
        if not text:
            print(f"[{i}/{len(transcriptions)}] Skipping empty transcription {transcription_id}")
            continue
        
        print(f"[{i}/{len(transcriptions)}] Processing: {text[:50]}...")
        
        interpretation = interpret_with_gemini(text, transcription_id)
        
        if interpretation:
            save_interpretation(transcription, interpretation)
            print(f"  ✓ Interpreted and saved")
        else:
            print(f"  ✗ Failed to interpret")
    
    print(f"\nDone! Interpretations saved to {INTERPRETATIONS_FILE}")

def display_interpretations(limit: int = 10):
    """Display recent interpretations."""
    if not INTERPRETATIONS_FILE.exists():
        print(f"No interpretations file found at {INTERPRETATIONS_FILE}")
        return
    
    interpretations = []
    with open(INTERPRETATIONS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                interpretations.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    
    # Show most recent
    interpretations = interpretations[-limit:]
    
    if not interpretations:
        print("No interpretations found.")
        return
    
    print(f"\n{'='*80}")
    print(f"Recent Interpretations ({len(interpretations)} shown)")
    print(f"{'='*80}\n")
    
    for entry in interpretations:
        orig = entry.get("original_transcription", {})
        interp = entry.get("interpretation", {})
        
        timestamp = entry.get("timestamp", "")
        print(f"[{timestamp}]")
        print(f"Original: {orig.get('text', '')[:100]}...")
        print(f"Summary: {interp.get('summary', 'N/A')}")
        print(f"Sentiment: {interp.get('sentiment', 'N/A')} | Confidence: {interp.get('confidence', 'N/A')}")
        if interp.get('keyEvents'):
            print(f"Key Events: {', '.join(interp['keyEvents'][:3])}")
        print(f"{'-'*80}\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python interpret_transcripts.py process [--limit N] [--all]")
        print("    Process transcriptions with Gemini (only unprocessed by default)")
        print("    --limit N: Process only the most recent N transcriptions")
        print("    --all: Process all transcriptions, even if already processed")
        print()
        print("  python interpret_transcripts.py show [N]")
        print("    Display recent interpretations (default: 10)")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "process":
        limit = None
        unprocessed_only = True
        
        # Parse arguments
        if "--limit" in sys.argv:
            idx = sys.argv.index("--limit")
            if idx + 1 < len(sys.argv):
                limit = int(sys.argv[idx + 1])
        
        if "--all" in sys.argv:
            unprocessed_only = False
        
        process_transcriptions(limit=limit, unprocessed_only=unprocessed_only)
    
    elif command == "show":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        display_interpretations(limit=limit)
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

