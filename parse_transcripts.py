#!/usr/bin/env python3
"""
Simple script to parse and display transcriptions from the JSONL file.
"""

import json
from pathlib import Path
from datetime import datetime

TRANSCRIPTS_FILE = Path("transcripts/transcriptions.jsonl")

def parse_transcripts(filter_text=None, since_minutes=None):
    """
    Parse transcriptions from the JSONL file.
    
    Args:
        filter_text: Optional text to filter transcriptions (case-insensitive)
        since_minutes: Optional number of minutes to filter recent transcriptions
    """
    if not TRANSCRIPTS_FILE.exists():
        print(f"No transcriptions file found at {TRANSCRIPTS_FILE}")
        return []
    
    transcriptions = []
    now = datetime.now()
    
    with open(TRANSCRIPTS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            
            try:
                entry = json.loads(line)
                
                # Filter by time if specified
                if since_minutes:
                    timestamp = datetime.fromisoformat(entry["timestamp"])
                    age_minutes = (now - timestamp).total_seconds() / 60
                    if age_minutes > since_minutes:
                        continue
                
                # Filter by text if specified
                if filter_text and filter_text.lower() not in entry["text"].lower():
                    continue
                
                transcriptions.append(entry)
            except json.JSONDecodeError as e:
                print(f"Error parsing line: {e}")
                continue
    
    return transcriptions

def display_transcripts(transcriptions):
    """Display transcriptions in a readable format."""
    if not transcriptions:
        print("No transcriptions found.")
        return
    
    print(f"\nFound {len(transcriptions)} transcription(s):\n")
    print("-" * 80)
    
    for entry in transcriptions:
        timestamp = datetime.fromisoformat(entry["timestamp"])
        print(f"[{timestamp.strftime('%Y-%m-%d %H:%M:%S')}] ({entry['source']})")
        print(f"  {entry['text']}")
        print("-" * 80)

def get_latest(n=10):
    """Get the latest N transcriptions."""
    transcriptions = parse_transcripts()
    return transcriptions[-n:] if transcriptions else []

def search(text):
    """Search for transcriptions containing specific text."""
    return parse_transcripts(filter_text=text)

def get_recent(minutes):
    """Get transcriptions from the last N minutes."""
    return parse_transcripts(since_minutes=minutes)

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) == 1:
        # Show all transcriptions
        transcriptions = parse_transcripts()
        display_transcripts(transcriptions)
    
    elif len(sys.argv) >= 3:
        command = sys.argv[1]
        
        if command == "latest":
            n = int(sys.argv[2])
            transcriptions = get_latest(n)
            display_transcripts(transcriptions)
        
        elif command == "search":
            text = " ".join(sys.argv[2:])
            transcriptions = search(text)
            display_transcripts(transcriptions)
        
        elif command == "recent":
            minutes = int(sys.argv[2])
            transcriptions = get_recent(minutes)
            display_transcripts(transcriptions)
        
        else:
            print("Unknown command")
            print_usage()
    
    else:
        print("Usage:")
        print("  python parse_transcripts.py                    # Show all transcriptions")
        print("  python parse_transcripts.py latest 10          # Show last 10 transcriptions")
        print("  python parse_transcripts.py search Derek       # Search for text")
        print("  python parse_transcripts.py recent 5           # Show transcriptions from last 5 minutes")
