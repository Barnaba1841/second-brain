import { useState, useRef, useEffect } from "react";

const SUPABASE_URL = "https://wjsoucmgnvyfqpqunftr.supabase.co";
const SUPABASE_KEY = "sb_publishable_AYqWbeHZizzJ3MDjlTZHAQ_h5IiPPav";

const SYSTEM_PROMPT = `You are the user's Second Brain — a personal AI assistant that has access to all the notes, ideas, and thoughts the user has ever dumped into their system.

Your job:
1. When the user asks a question, search through their notes and answer based ONLY on what they've written.
2. When the user dumps a new note/idea, confirm it's saved and optionally make a brief insightful observation.
3. Help them connect ideas across notes when relevant.
4. Be concise, warm, and feel like a trusted personal assistant who knows their mind.

Always ground your answers in their actual notes. If something isn't in their notes, say so honestly.`;

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export default function SecondBrain() {
  const [notes, setNotes] = useState([]);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hey! I'm your Second Brain 🧠\n\nDump anything — ideas, thoughts, notes, reminders. Or ask me anything you've already told me.\n\nYour notes sync across all your devices!" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [mode, setMode] = useState("chat");
  const bottomRef = useRef(null);

  useEffect(() => { fetchNotes(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const fetchNotes = async () => {
    setLoadingNotes(true);
    try {
      const data = await sbFetch("/notes?order=created_at.desc");
      setNotes(data);
    } catch (err) { console.error("Failed to load notes:", err); }
    setLoadingNotes(false);
  };

  const isDump = (text) => {
    const lower = text.toLowerCase();
    return lower.startsWith("dump:") || lower.startsWith("note:") || lower.startsWith("idea:") || lower.startsWith("save:");
  };

  const saveNote = async (text) => {
    const cleaned = text.replace(/^(dump|note|idea|save):\s*/i, "").trim();
    const data = await sbFetch("/notes", { method: "POST", body: JSON.stringify({ text: cleaned }) });
    setNotes(prev => [data[0], ...prev]);
    return cleaned;
  };

  const deleteNote = async (id) => {
    await sbFetch(`/notes?id=eq.${id}`, { method: "DELETE" });
    setNotes(prev => prev.filter(n => n.id !== id));
  };

  const buildNotesContext = () => {
    if (notes.length === 0) return "The user has no notes yet.";
    return notes.map((n, i) => {
      const date = new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `[Note ${i + 1} - ${date}]: ${n.text}`;
    }).join("\n");
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setLoading(true);

    let savedText = null;
    if (isDump(text)) {
      try { savedText = await saveNote(text); }
      catch {
        setMessages(prev => [...prev, { role: "assistant", text: "❌ Failed to save note. Check your connection." }]);
        setLoading(false);
        return;
      }
    }

    try {
      const notesContext = buildNotesContext();
      const conversationHistory = messages.slice(1).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text
      }));
      const userContent = savedText
        ? `I just dumped a new note: "${savedText}"\n\nConfirm it's saved and give a brief insight if relevant.`
        : text;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `${SYSTEM_PROMPT}\n\n--- USER'S NOTES ---\n${notesContext}\n--- END NOTES ---`,
          messages: [...conversationHistory, { role: "user", content: userContent }]
        })
      });

      const data = await response.json();
      const reply = data.content?.map(b => b.text || "").join("") || "Something went wrong.";
      setMessages(prev => [...prev, { role: "assistant", text: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Oops, something went wrong. Try again." }]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const formatTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ minHeight:"100vh", background:"#0d0d0d", fontFamily:"'Georgia','Times New Roman',serif", color:"#e8e0d0", display:"flex", flexDirection:"column" }}>
      <div style={{ borderBottom:"1px solid #2a2a2a", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", background:"#0d0d0d", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:36, height:36, background:"linear-gradient(135deg,#c9a96e,#8b6914)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🧠</div>
          <div>
            <div style={{ fontSize:18, fontWeight:"bold", color:"#c9a96e", letterSpacing:"0.02em" }}>Second Brain</div>
            <div style={{ fontSize:11, color:"#666", fontFamily:"monospace" }}>{loadingNotes ? "syncing..." : `${notes.length} notes · synced to cloud ☁️`}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {["chat","notes"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ padding:"6px 16px", borderRadius:20, border:"1px solid", borderColor:mode===m?"#c9a96e":"#333", background:mode===m?"#c9a96e22":"transparent", color:mode===m?"#c9a96e":"#666", cursor:"pointer", fontSize:12, fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.08em" }}>{m}</button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column", maxWidth:720, width:"100%", margin:"0 auto", padding:"0 16px" }}>
        {mode === "chat" ? (
          <>
            <div style={{ flex:1, overflowY:"auto", padding:"24px 0", display:"flex", flexDirection:"column", gap:16 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start" }}>
                  <div style={{ maxWidth:"80%", padding:"12px 16px", borderRadius:msg.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px", background:msg.role==="user"?"#1a1a2e":"#1a1a1a", border:"1px solid", borderColor:msg.role==="user"?"#2a2a5e":"#2a2a2a", fontSize:14, lineHeight:1.6, color:msg.role==="user"?"#a0b4ff":"#e8e0d0", whiteSpace:"pre-wrap" }}>{msg.text}</div>
                </div>
              ))}
              {loading && (
                <div style={{ display:"flex", justifyContent:"flex-start" }}>
                  <div style={{ padding:"12px 16px", borderRadius:"18px 18px 18px 4px", background:"#1a1a1a", border:"1px solid #2a2a2a", display:"flex", gap:4, alignItems:"center" }}>
                    {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#c9a96e", animation:"pulse 1.2s ease-in-out infinite", animationDelay:`${i*0.2}s` }} />)}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div style={{ padding:"0 0 8px", fontSize:11, color:"#444", fontFamily:"monospace", textAlign:"center" }}>tip: start with "dump:" or "note:" to save · just ask to recall</div>
            <div style={{ padding:"12px 0 20px", display:"flex", gap:10, alignItems:"flex-end" }}>
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder='dump: had an idea about...' rows={1}
                style={{ flex:1, background:"#141414", border:"1px solid #2a2a2a", borderRadius:12, padding:"12px 16px", color:"#e8e0d0", fontSize:14, fontFamily:"Georgia,serif", resize:"none", outline:"none", lineHeight:1.5, minHeight:48, maxHeight:120, overflowY:"auto" }}
                onFocus={e => e.target.style.borderColor="#c9a96e55"}
                onBlur={e => e.target.style.borderColor="#2a2a2a"}
                onInput={e => { e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
              />
              <button onClick={handleSend} disabled={loading||!input.trim()} style={{ width:48, height:48, borderRadius:12, border:"none", background:loading||!input.trim()?"#1a1a1a":"linear-gradient(135deg,#c9a96e,#8b6914)", color:loading||!input.trim()?"#444":"#0d0d0d", cursor:loading||!input.trim()?"not-allowed":"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>↑</button>
            </div>
          </>
        ) : (
          <div style={{ flex:1, overflowY:"auto", padding:"24px 0" }}>
            {loadingNotes ? (
              <div style={{ textAlign:"center", color:"#666", marginTop:80 }}><div style={{ fontSize:32, marginBottom:12 }}>⏳</div><div>Loading your notes...</div></div>
            ) : notes.length === 0 ? (
              <div style={{ textAlign:"center", color:"#444", marginTop:80 }}><div style={{ fontSize:48, marginBottom:16 }}>🌱</div><div style={{ fontSize:16, color:"#666" }}>No notes yet.</div><div style={{ fontSize:13, color:"#444", marginTop:8 }}>Go to Chat and dump something!</div></div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {notes.map(note => (
                  <div key={note.id} style={{ background:"#141414", border:"1px solid #2a2a2a", borderRadius:12, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, lineHeight:1.6, color:"#e8e0d0" }}>{note.text}</div>
                      <div style={{ fontSize:11, color:"#555", marginTop:6, fontFamily:"monospace" }}>{formatDate(note.created_at)} · {formatTime(note.created_at)}</div>
                    </div>
                    <button onClick={() => deleteNote(note.id)} style={{ background:"none", border:"none", color:"#444", cursor:"pointer", fontSize:14, padding:"2px 4px", borderRadius:4, flexShrink:0 }}
                      onMouseEnter={e => e.target.style.color="#c0392b"} onMouseLeave={e => e.target.style.color="#444"}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:2px}textarea::placeholder{color:#444}`}</style>
    </div>
  );
}
