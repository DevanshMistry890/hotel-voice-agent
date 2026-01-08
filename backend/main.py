"""
The Grand Hotel - Voice AI Backend
Author: Devansh Mistry
Stack: FastAPI, Gemini 2.5 Flash, ChromaDB (RAG), EdgeTTS, Google Sheets CRM
"""

import os
import time
import uuid
import json
import datetime
import logging
from typing import List, Dict, Any, Optional

# --- Third-Party Imports ---
from fastapi import FastAPI, Body, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
import edge_tts
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import chromadb

# --- 1. CONFIGURATION & SETUP ---
load_dotenv() # Load environment variables

# Logging Config (Keep it simple for the demo visual)
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("HotelAI")

# Constants
API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.5-flash-lite")
SHEET_NAME = os.getenv("SHEET_NAME", "Hotel Call Logs")
CREDS_FILE = os.getenv("GOOGLE_CREDS_FILE", "credentials.json")
DB_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")

# Validate Keys
if not API_KEY:
    raise ValueError("❌ CRITICAL: GEMINI_API_KEY is missing from .env file")

# --- 2. SERVICE INITIALIZATION ---

# A. Gemini AI
genai.configure(api_key=API_KEY)
model = genai.GenerativeModel(MODEL_NAME)

SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
}

# B. Google Sheets (CRM)
try:
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    creds = ServiceAccountCredentials.from_json_keyfile_name(CREDS_FILE, scope)
    client = gspread.authorize(creds)
    sheet = client.open(SHEET_NAME).sheet1
    print("✅ CRM Connected: Google Sheets")
except Exception as e:
    print(f"⚠️ CRM Warning: Could not connect to Sheets. Error: {e}")
    sheet = None

# C. ChromaDB (RAG Knowledge Base)
print("⚙️ Connecting to Vector Database...")
try:
    chroma_client = chromadb.PersistentClient(path=DB_PATH)
    collection = chroma_client.get_collection(name="hotel_knowledge")
    print(f"✅ Knowledge Base Connected. Loaded {collection.count()} documents.")
except Exception as e:
    print(f"⚠️ RAG Warning: Could not find database at {DB_PATH}. Did you run ingest.py?")
    collection = None

# --- 3. HELPER FUNCTIONS (Business Logic) ---

def retrieve_rag_context(query: str) -> str:
    """Retrieves relevant policy info from ChromaDB."""
    if not collection:
        return "System Note: Knowledge base unavailable."
    
    print(f"🔍 RAG SEARCH: '{query}'") # Demo visual
    results = collection.query(query_texts=[query], n_results=1)
    
    if results['documents'] and results['documents'][0]:
        doc_content = results['documents'][0][0]
        source = results['metadatas'][0][0].get('source', 'Unknown')
        return f"Source ({source}): {doc_content}"
    
    return "No specific policy found."

def check_availability_tool(date_str: str, room_type: str) -> str:
    """Mock Tool: Checks room availability logic."""
    try:
        query_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
        # Logic: Weekends (Fri=4, Sat=5) are sold out
        if query_date.weekday() in [4, 5]: 
            return f"System Note: {room_type} is SOLD OUT on {date_str}."
        else:
            return f"System Note: {room_type} is AVAILABLE on {date_str}. Price: $150."
    except ValueError:
        return "System Note: Invalid date format."

def analyze_and_log_call(history: List[Dict]):
    """Analyzes the transcript and logs to CRM (Blocking/Sync for Demo reliability)."""
    if not sheet:
        print("❌ Logging Skipped: No Sheet Connection")
        return

    transcript = "\n".join([f"{msg['role']}: {msg['parts']}" for msg in history if "SYSTEM" not in str(msg['parts'])])
    
    prompt = f"""
    Summarize this hotel call into JSON:
    {{
        "guest_name": "Name/Unknown",
        "intent": "Booking/Inquiry",
        "summary": "Short summary",
        "action_required": "Yes/No"
    }}
    Transcript: {transcript}
    """
    
    # Retry logic for robustness
    for attempt in range(2):
        try:
            summary_model = genai.GenerativeModel(MODEL_NAME) 
            response = summary_model.generate_content(prompt, safety_settings=SAFETY_SETTINGS)
            
            # Clean JSON markdown if present
            text = response.text.replace("```json", "").replace("```", "").strip()
            data = json.loads(text)
            
            sheet.append_row([
                datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                data.get("guest_name", "Unknown"),
                data.get("intent", "General"),
                data.get("summary", ""),
                data.get("action_required", "No")
            ])
            print("✅ Logged to Sheet")
            return # Success
        except Exception as e:
            print(f"❌ Logging attempt {attempt+1} failed: {e}")
            time.sleep(2)

# --- 4. FASTAPI APP SETUP ---

app = FastAPI(title="Grand Hotel AI Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-Memory Session State
active_sessions: Dict[str, List[Dict]] = {}
TODAY = datetime.date.today()

# Orchestrator Prompt
SYSTEM_PROMPT = f"""
You are 'Aria', a receptionist at The Grand Hotel. Today is {TODAY}.

CRITICAL VOICE RULES (Follow these strictly):
1. **BE CONCISE:** Voice answers must be SHORT (max 2 sentences, ~20 words) unless user ask explicitly.
2. **SUMMARIZE RAG:** If given [RAG CONTEXT], extract only the specific answer. Do not read the whole policy.
3. **NO LISTS:** Speak naturally. Do not say "First, Second...".

ORCHESTRATION INSTRUCTIONS:
1. If given [RAG CONTEXT], use a filler like "Let me check our guide/policy..." then summarize the finding.
2. If user asks for dates, use the [TOOL OUTPUT].
3. Keep answers conversational, warm, and concise.

YOUR BASE KNOWLEDGE:
- Standard Room: $150. Deluxe: $250.
"""

# --- 5. API ROUTES ---

@app.get("/greet")
async def start_call():
    """Initializes a new session and returns the welcome message."""
    session_id = str(uuid.uuid4())
    greeting = "Good morning, The Grand Hotel. Aria speaking. How can I help you?"
    
    active_sessions[session_id] = [
        {"role": "user", "parts": SYSTEM_PROMPT},
        {"role": "model", "parts": "Understood. I will be concise."},
        {"role": "model", "parts": greeting} 
    ]
    
    # Generate Audio
    communicate = edge_tts.Communicate(greeting, "en-GB-SoniaNeural")
    await communicate.save(f"audio_{session_id}.mp3")

    return JSONResponse({
        "session_id": session_id,
        "text": greeting,
        "audio_url": f"http://localhost:8000/audio/{session_id}"
    })

@app.post("/chat")
async def handle_chat(text: str = Body(..., embed=True), session_id: str = Body(..., embed=True)):
    """Main Orchestrator: Handles Intent, Tools, RAG, and Generation."""
    print(f"📞 Session {session_id[:4]} User: {text}")
    
    if session_id not in active_sessions:
        return JSONResponse({"error": "Session expired"}, status_code=400)

    # --- ORCHESTRATION LAYER ---
    rag_context = ""
    tool_context = ""

    # 1. Intent Detection: Policy/RAG
    rag_keywords = ["wheelchair", "access", "disability", "cancel", "refund", "policy", "fee", "grandmother"]
    if any(k in text.lower() for k in rag_keywords):
        retrieved_doc = retrieve_rag_context(text)
        rag_context = f"\n[RAG CONTEXT FOUND]: {retrieved_doc}"
        print(f"💡 ORCHESTRATOR: Injecting RAG Context")

    # 2. Intent Detection: Availability Tool
    if "tomorrow" in text.lower() or "date" in text.lower():
        tmrw = TODAY + datetime.timedelta(days=1)
        tool_result = check_availability_tool(str(tmrw), "Standard Room")
        tool_context = f"\n[TOOL OUTPUT]: {tool_result}"
        print(f"💡 ORCHESTRATOR: Injecting Tool Output")

    # 3. Assemble Prompt
    user_content = text + rag_context + tool_context
    active_sessions[session_id].append({"role": "user", "parts": user_content})

    # 4. Generate Response
    try:
        chat = model.start_chat(history=active_sessions[session_id])
        response = chat.send_message(user_content, safety_settings=SAFETY_SETTINGS)
        ai_text = response.text
    except Exception as e:
        print(f"⚠️ Generation Error: {e}")
        ai_text = "I apologize, I missed that. Could you repeat?"

    # 5. Save State & Audio
    active_sessions[session_id].append({"role": "model", "parts": ai_text})
    
    communicate = edge_tts.Communicate(ai_text, "en-GB-SoniaNeural")
    await communicate.save(f"audio_{session_id}.mp3")

    return JSONResponse({
        "text": ai_text,
        "audio_url": f"http://localhost:8000/audio/{session_id}"
    })

@app.post("/end_call")
async def end_call(session_id: str = Body(..., embed=True)):
    """Ends the session and triggers blocking CRM logging."""
    if session_id in active_sessions:
        history = active_sessions[session_id]
        del active_sessions[session_id]
        
        # Blocking call to ensure UI shows the spinner until logging is done
        print("📝 Generating summary and updating sheet... (Please wait)")
        analyze_and_log_call(history)
        
    return {"status": "ok"}

@app.get("/audio/{session_id}")
def get_audio(session_id: str):
    """Serves the generated audio file."""
    return FileResponse(f"audio_{session_id}.mp3", media_type="audio/mpeg")

# --- MAIN ENTRY POINT ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)