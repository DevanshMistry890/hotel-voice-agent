"use client";
import { useState, useEffect, useRef } from "react";

// --- TYPES & INTERFACES ---
type CallStatus = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING" | "SAVING";

// Extend Window interface for SpeechRecognition
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// --- VISUAL ASSETS ---

const Orb = ({ state }: { state: CallStatus }) => {
  const isActive = state === "SPEAKING" || state === "PROCESSING";
  const isListening = state === "LISTENING";
  const isSaving = state === "SAVING";

  return (
    <div className="relative flex items-center justify-center py-10">
      <div
        className={`w-48 h-48 rounded-full blur-3xl absolute transition-all duration-1000 ease-in-out ${
          isActive ? "bg-indigo-500/40 scale-125 opacity-70" :
          isListening ? "bg-emerald-400/30 scale-110 opacity-50" :
          isSaving ? "bg-amber-400/30 scale-100 opacity-60" : // New State
          "bg-slate-300/20 scale-90 opacity-30"
        }`}
      />
      <div
        className={`w-32 h-32 rounded-full shadow-[0_0_80px_-20px_rgba(0,0,0,0.3)] z-10 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex items-center justify-center border border-white/20 backdrop-blur-md ${
          isActive ? "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 animate-pulse scale-110 shadow-indigo-500/50" :
          isListening ? "bg-gradient-to-br from-emerald-400 to-cyan-500 scale-100 shadow-emerald-500/40" :
          isSaving ? "bg-gradient-to-br from-amber-300 to-orange-400 animate-pulse scale-95 shadow-amber-500/40" : // New State
          "bg-gradient-to-b from-slate-100 to-slate-300 scale-95 grayscale shadow-xl"
        }`}
      >
        <div className="w-24 h-24 rounded-full bg-gradient-to-t from-white/10 to-white/50 border-t border-white/60"></div>
      </div>
    </div>
  );
};

// --- MAIN PAGE ---

export default function Home() {
  const [callStatus, setCallStatus] = useState<CallStatus>("IDLE");
  const [transcript, setTranscript] = useState("Click 'Start Conversation' to begin...");
  const [logs, setLogs] = useState<{ sender: string; text: string }[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTextRef = useRef<string>(""); 

  useEffect(() => {
    if (typeof window !== "undefined" && (window.webkitSpeechRecognition || window.SpeechRecognition)) {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onstart = () => {
         // Only switch to listening if we aren't saving
         setCallStatus(prev => prev === "SAVING" ? "SAVING" : "LISTENING");
      };

      recognitionRef.current.onresult = (event: any) => {
        let currentTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
            recognitionRef.current.stop();
            accumulatedTextRef.current = currentTranscript;
            handleUserSpeech(currentTranscript);
        }, 2000); 
      };
    }
  }, [sessionId]);

  const startCall = async () => {
    setCallStatus("PROCESSING");
    setTranscript("Connecting to Aria...");
    setLogs([]);
    try {
      const res = await fetch(`${API_URL}/greet`);
      const data = await res.json();
      setSessionId(data.session_id);
      playAudio(data.audio_url, data.text);
    } catch (e) {
      console.error(e);
      setTranscript("Error connecting to server.");
      setCallStatus("IDLE");
    }
  };

  const handleUserSpeech = async (text: string) => {
    if (!text.trim() || !sessionId) return;
    setCallStatus("PROCESSING");
    addLog("Guest", text);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, session_id: sessionId }),
      });
      const data = await res.json();
      if (data.error) {
          alert("Session Expired.");
          setCallStatus("IDLE");
          return;
      }
      playAudio(data.audio_url, data.text);
    } catch (e) {
      setTranscript("Connection Error.");
      setCallStatus("IDLE");
    }
  };

  const playAudio = (url: string, textDisplay: string) => {
    setCallStatus("SPEAKING");
    addLog("Aria", textDisplay);
    setTranscript(textDisplay);
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(`${url}?t=${Date.now()}`);
    audioRef.current = audio;
    audio.play().catch(e => console.error("Audio play failed:", e));
    audio.onended = () => {
        setCallStatus("LISTENING");
        accumulatedTextRef.current = "";
        recognitionRef.current.start(); 
    };
  };

  const endCall = async () => {
    if (audioRef.current) audioRef.current.pause();
    if (recognitionRef.current) recognitionRef.current.stop();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    // UX UPGRADE: Show "Saving" state
    setCallStatus("SAVING"); 
    setTranscript("Saving call summary to CRM...");

    if (sessionId) {
        try {
            await fetch(`${API_URL}/end_call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: sessionId }),
            });
        } catch (e) {
            console.error("Failed to save log");
        }
        setSessionId(null);
    }
    
    // Reset after save
    setCallStatus("IDLE");
    setTranscript("Call Ended. Log saved.");
  };

  const addLog = (sender: string, text: string) => {
    setLogs((prev) => [...prev, { sender, text }]);
  };

  // --- DYNAMIC STYLES ---
  const getCardGlow = () => {
    switch (callStatus) {
        case "LISTENING": return "shadow-[0_0_60px_-15px_rgba(52,211,153,0.3)] border-emerald-500/20";
        case "SPEAKING": return "shadow-[0_0_60px_-15px_rgba(99,102,241,0.3)] border-indigo-500/20";
        case "PROCESSING": return "shadow-[0_0_60px_-15px_rgba(168,85,247,0.3)] border-purple-500/20";
        case "SAVING": return "shadow-[0_0_60px_-15px_rgba(251,191,36,0.3)] border-amber-500/20";
        default: return "shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border-white/40";
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-slate-800 font-sans flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-1000">
      
      {/* Background Ambience */}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${callStatus === 'IDLE' ? 'opacity-30' : 'opacity-20'}`}>
          <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-purple-200/40 blur-[150px] rounded-full animate-blob"></div>
          <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-indigo-200/40 blur-[150px] rounded-full animate-blob animation-delay-2000"></div>
      </div>

      <main className={`relative z-10 w-full max-w-md bg-white/60 backdrop-blur-3xl rounded-[2.5rem] border p-8 flex flex-col items-center justify-between h-[85vh] transition-all duration-700 ease-out ${getCardGlow()}`}>
        
        {/* Header */}
        <div className="w-full flex justify-between items-center">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/50 border border-white/50 shadow-sm backdrop-blur-md">
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">THE GRAND HOTEL</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-white/50">
                <span className={`w-1.5 h-1.5 rounded-full ${callStatus === "IDLE" ? "bg-slate-400" : "bg-emerald-500 animate-pulse"}`}></span>
                <span className="text-[10px] font-bold tracking-wider text-slate-500">{callStatus}</span>
            </div>
        </div>

        {/* Visualizer */}
        <div className="flex-grow flex flex-col items-center justify-center gap-6 w-full relative">
            <Orb state={callStatus} />
            <div className="text-center space-y-2 max-w-xs z-10">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-800">
                   {callStatus === "IDLE" ? "Hotel AI Agent" : "Aria"}
                </h2>
                <div className="h-16 flex items-center justify-center">
                    <p className={`text-base font-medium leading-relaxed transition-all duration-500 ${
                        callStatus === "LISTENING" ? "text-slate-400" : 
                        callStatus === "SPEAKING" ? "text-slate-700 scale-105" :
                        "text-slate-300 blur-[0.5px]"
                    }`}>
                        "{transcript}"
                    </p>
                </div>
            </div>
        </div>

        {/* Controls */}
        <div className="w-full flex flex-col gap-5 z-20">
            {callStatus === "IDLE" ? (
                <button onClick={startCall} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-semibold hover:shadow-2xl hover:-translate-y-1 transition-all">
                    Start Conversation
                </button>
            ) : callStatus === "SAVING" ? (
                <button disabled className="w-full py-5 bg-amber-50 text-amber-600 border border-amber-100 rounded-2xl font-semibold flex items-center justify-center gap-2 cursor-wait">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    Saving to CRM...
                </button>
            ) : (
                <button onClick={endCall} className="w-full py-5 bg-white border border-red-100 text-red-500 rounded-2xl font-semibold hover:bg-red-50 transition-all">
                    End Call & Save Summary
                </button>
            )}
            
            {/* Logs */}
            <div className="h-32 w-full bg-white/50 backdrop-blur-sm rounded-xl border border-white/60 overflow-y-auto p-4 text-xs font-mono space-y-3 scrollbar-hide">
                 {logs.map((log, i) => (
                    <div key={i} className={`flex ${log.sender === "Guest" ? "justify-end" : "justify-start"}`}>
                        <span className={`px-3 py-2 rounded-2xl ${log.sender === "Guest" ? "bg-indigo-50 text-indigo-700" : "bg-white text-slate-600 border border-slate-100"}`}>
                            {log.text}
                        </span>
                    </div>
                ))}
            </div>
        </div>
      </main>
      
      <div className="absolute bottom-6 text-slate-300 text-[10px] font-mono tracking-[0.2em] uppercase opacity-60">
        Project By Devansh Mistry
      </div>
    </div>
  );
}