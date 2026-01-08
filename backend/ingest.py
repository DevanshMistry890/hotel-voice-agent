"""
The Grand Hotel - Voice AI Backend
Author: Devansh Mistry
Stack: FastAPI, Gemini 2.5 Flash, ChromaDB (RAG), EdgeTTS, Google Sheets CRM
"""
import os
import chromadb
from chromadb.utils import embedding_functions

# 1. SETUP DATABASE
# We save to a folder called 'chroma_db' so it persists on disk
PERSIST_DIRECTORY = "./chroma_db"
client = chromadb.PersistentClient(path=PERSIST_DIRECTORY)

# Delete old collection if exists (to avoid duplicates during testing)
try:
    client.delete_collection(name="hotel_knowledge")
    print("🗑️  Deleted old database version.")
except:
    pass

# Create new collection
# Uses default Sentence Transformers (all-MiniLM-L6-v2) for embeddings
collection = client.create_collection(name="hotel_knowledge")

# 2. LOAD FILES
KB_FOLDER = "./knowledge_base"
documents = []
metadatas = []
ids = []

print(f"📂 Scanning {KB_FOLDER}...")

if not os.path.exists(KB_FOLDER):
    os.makedirs(KB_FOLDER)
    print(f"⚠️ Created {KB_FOLDER}. Please add .txt files!")

for filename in os.listdir(KB_FOLDER):
    if filename.endswith(".txt"):
        file_path = os.path.join(KB_FOLDER, filename)
        with open(file_path, "r", encoding="utf-8") as f:
            text = f.read()
            
            # Simple Chunking (In production, use LangChain text splitters)
            # Here we treat each file as one "chunk" for simplicity
            documents.append(text)
            metadatas.append({"source": filename})
            ids.append(filename)
            print(f"   -> Loaded: {filename}")

# 3. SAVE TO DB
if documents:
    collection.add(
        documents=documents,
        metadatas=metadatas,
        ids=ids
    )
    print(f"✅ Success! Ingested {len(documents)} documents into '{PERSIST_DIRECTORY}'.")
else:
    print("❌ No documents found. Please add files to /knowledge_base")