import { useState, useRef, useEffect } from "react";

const SUPABASE_URL = "https://wjsoucmgnvyfqpqunftr.supabase.co";
const SUPABASE_KEY = "sb_publishable_AYqWbeHZizzJ3MDjlTZHAQ_h5IiPPav";

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
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function callClaude(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages
    })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "";
}

export default function App() {
  const [view, setView] = useState("dump"); // dump | browse | chat
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [chatMessages, setChatMessages] = useState([
    { role: "assistant", text: "Ask me anything from your Second Brain 🧠" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const loadAll = async () => {
    const [cats, projs, chaps, nts] = await Promise.all([
      sbFetch("/categories?order=id.asc"),
      sbFetch("/projects?order=id.asc"),
      sbFetch("/chapters?order=order_index.asc"),
      sbFetch("/notes2?order=created_at.desc")
    ]);
    setCategories(cats);
    setProjects(projs);
    setChapters(chaps);
    setNotes(nts);
  };

  const buildContext = () => {
    return `
CATEGORIES: ${categories.map(c => `${c.emoji} ${c.name} (id:${c.id})`).join(", ")}
PROJECTS: ${projects.map(p => `"${p.name}" (id:${p.id}, category_id:${p.category_id})`).join(", ")}
CHAPTERS: ${chapters.map(c => `"${c.name}" (id:${c.id}, project_id:${c.project_id})`).join(", ")}
RECENT NOTES: ${notes.slice(0, 30).map(n => n.text).join(" | ")}
    `.trim();
  };

  const handleDump = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);
    setStatus("🤖 AI is reading your note...");

    try {
      const context = buildContext();

      // AI decides where this note goes
      const sortPrompt = `You are organizing a personal Second Brain. Given the note below, decide the best category, project, chapter, and tags.

EXISTING STRUCTURE:
${context}

NOTE: "${text}"

Reply ONLY in this exact JSON format (no markdown, no explanation):
{
  "category_id": <number or null>,
  "project_id": <number or null>,
  "chapter_id": <number or null>,
  "tags": ["tag1", "tag2"],
  "inbox": <true if truly random/unclassifiable, false otherwise>,
  "ai_confidence": <0-100>,
  "new_project": <"Project Name" or null if existing project fits>,
  "new_chapter": <"Chapter Name" or null if existing chapter fits>,
  "reasoning": "one line explanation"
}`;

      const aiReply = await callClaude([{ role: "user", content: sortPrompt }], "You are a JSON-only responder. Never include markdown or explanation outside the JSON.");

      let parsed;
      try {
        const clean = aiReply.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        parsed = { category_id: null, project_id: null, chapter_id: null, tags: [], inbox: true, ai_confidence: 0, reasoning: "Could not parse" };
      }

      setStatus(`💡 ${parsed.reasoning}`);

      // Create new project if needed
      let projectId = parsed.project_id;
      if (parsed.new_project && !projectId) {
        const newProj = await sbFetch("/projects", {
          method: "POST",
          body: JSON.stringify({ name: parsed.new_project, category_id: parsed.category_id })
        });
        projectId = newProj[0]?.id;
        setProjects(prev => [...prev, newProj[0]]);
      }

      // Create new chapter if needed
      let chapterId = parsed.chapter_id;
      if (parsed.new_chapter && !chapterId && projectId) {
        const newChap = await sbFetch("/chapters", {
          method: "POST",
          body: JSON.stringify({ name: parsed.new_chapter, project_id: projectId, order_index: 0 })
        });
        chapterId = newChap[0]?.id;
        setChapters(prev => [...prev, newChap[0]]);
      }

      // Save note
      const saved = await sbFetch("/notes2", {
        method: "POST",
        body: JSON.stringify({
          text,
          category_id: parsed.category_id,
          project_id: projectId || null,
          chapter_id: chapterId || null,
          tags: parsed.tags || [],
          inbox: parsed.inbox || false,
          ai_confidence: parsed.ai_confidence || 0
        })
      });

      setNotes(prev => [saved[0], ...prev]);

      // Show where it was filed
      const cat = categories.find(c => c.id === parsed.category_id);
      const proj = projects.find(p => p.id === projectId) || (parsed.new_project ? { name: parsed.new_project } : null);
      const chap = chapters.find(c => c.id === chapterId) || (parsed.new_chapter ? { name: parsed.new_chapter } : null);

      let filed = cat ? `${cat.emoji} ${cat.name}` : "🗂️ Inbox";
      if (proj) filed += ` → ${proj.name}`;
      if (chap) filed += ` → ${chap.name}`;

      setStatus(`✅ Filed under: ${filed} (${parsed.ai_confidence}% confident)`);
    } catch (err) {
      setStatus("❌ Something went wrong. Try again.");
    }

    setLoading(false);
    setTimeout(() => setStatus(""), 5000);
  };

  const handleChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text }]);
    setChatLoading(true);

    const allNotes = notes.map(n => {
      const cat = categories.find(c => c.id === n.category_id);
      const proj = projects.find(p => p.id === n.project_id);
      const chap = chapters.find(c => c.id === n.chapter_id);
      return `[${cat?.emoji || "🗂️"} ${cat?.name || "Inbox"}${proj ? " → " + proj.name : ""}${chap ? " → " + chap.name : ""}]: ${n.text}`;
    }).join("\n");

    const system = `You are the user's Second Brain AI. Answer ONLY from their notes below. Be concise and insightful. Connect ideas across notes when relevant.

NOTES:
${allNotes || "No notes yet."}`;

    const history = chatMessages.slice(1).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
    const reply = await callClaude([...history, { role: "user", content: text }], system);
    setChatMessages(prev => [...prev, { role: "assistant", text: reply }]);
    setChatLoading(false);
  };

  const filteredNotes = notes.filter(n => {
    if (selectedChapter) return n.chapter_id === selectedChapter;
    if (selectedProject) return n.project_id === selectedProject;
    if (selectedCat) return n.category_id === selectedCat;
    return true;
  });

  const S = {
    app: { minHeight: "100vh", background: "#0a0a0a", color: "#e8e0d0", fontFamily: "Georgia, serif", display: "flex", flexDirection: "column" },
    header: { borderBottom: "1px solid #1e1e1e", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10, background: "#0a0a0a" },
    logo: { fontSize: 16, fontWeight: "bold", color: "#c9a96e", letterSpacing: "0.05em" },
    nav: { display: "flex", gap: 6 },
    navBtn: (active) => ({ padding: "6px 14px", borderRadius: 20, border: "1px solid", borderColor: active ? "#c9a96e" : "#222", background: active ? "#c9a96e18" : "transparent", color: active ? "#c9a96e" : "#555", cursor: "pointer", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }),
    main: { flex: 1, maxWidth: 760, width: "100%", margin: "0 auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 },
    card: { background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "16px 18px" },
    textarea: { width: "100%", background: "#0d0d0d", border: "1px solid #222", borderRadius: 10, padding: "14px", color: "#e8e0d0", fontSize: 14, fontFamily: "Georgia, serif", resize: "none", outline: "none", lineHeight: 1.6, minHeight: 100 },
    btn: (disabled) => ({ padding: "10px 24px", borderRadius: 10, border: "none", background: disabled ? "#1a1a1a" : "linear-gradient(135deg,#c9a96e,#8b6914)", color: disabled ? "#444" : "#0a0a0a", cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, fontWeight: "bold", fontFamily: "Georgia, serif" }),
    status: { fontSize: 12, color: "#c9a96e", fontFamily: "monospace", minHeight: 20 },
    label: { fontSize: 11, color: "#555", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 },
    sidebarItem: (active) => ({ padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13, background: active ? "#c9a96e18" : "transparent", color: active ? "#c9a96e" : "#888", border: "1px solid", borderColor: active ? "#c9a96e33" : "transparent", marginBottom: 2 }),
    noteCard: { background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: "12px 14px", marginBottom: 8 },
    tag: { display: "inline-block", padding: "2px 8px", borderRadius: 10, background: "#1a1a1a", border: "1px solid #2a2a2a", fontSize: 10, color: "#666", fontFamily: "monospace", marginRight: 4 },
    chatBubble: (isUser) => ({ maxWidth: "80%", padding: "10px 14px", borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: isUser ? "#1a1a2e" : "#111", border: "1px solid", borderColor: isUser ? "#2a2a5e" : "#1e1e1e", fontSize: 13, lineHeight: 1.6, color: isUser ? "#a0b4ff" : "#e8e0d0", whiteSpace: "pre-wrap" })
  };

  return (
    <div style={S.app}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>🧠 Second Brain</div>
        <div style={S.nav}>
          {[["dump","Dump"],["browse","Browse"],["chat","Ask AI"]].map(([v,l]) => (
            <button key={v} style={S.navBtn(view===v)} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#333", fontFamily: "monospace" }}>{notes.length} notes</div>
      </div>

      <div style={S.main}>

        {/* DUMP VIEW */}
        {view === "dump" && (
          <div>
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={S.label}>Dump anything — AI will sort it</div>
              <textarea
                style={S.textarea}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Just type freely... an idea, a thought, a story note, anything."
                onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) handleDump(); }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <div style={S.status}>{status || (loading ? "🤖 Thinking..." : "Ctrl+Enter to save")}</div>
                <button style={S.btn(loading || !input.trim())} onClick={handleDump} disabled={loading || !input.trim()}>
                  {loading ? "Saving..." : "Dump →"}
                </button>
              </div>
            </div>

            {/* Recent dumps */}
            <div style={S.label}>Recently saved</div>
            {notes.slice(0, 5).map(note => {
              const cat = categories.find(c => c.id === note.category_id);
              const proj = projects.find(p => p.id === note.project_id);
              const chap = chapters.find(c => c.id === note.chapter_id);
              return (
                <div key={note.id} style={S.noteCard}>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: "#d0c8b8", marginBottom: 6 }}>{note.text}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "#c9a96e", fontFamily: "monospace" }}>
                      {cat?.emoji} {cat?.name || "Inbox"}{proj ? ` → ${proj.name}` : ""}{chap ? ` → ${chap.name}` : ""}
                    </span>
                    {(note.tags || []).map(t => <span key={t} style={S.tag}>#{t}</span>)}
                    <span style={{ fontSize: 10, color: "#333", fontFamily: "monospace", marginLeft: "auto" }}>
                      {note.ai_confidence}% confident
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* BROWSE VIEW */}
        {view === "browse" && (
          <div style={{ display: "flex", gap: 16 }}>
            {/* Sidebar */}
            <div style={{ width: 200, flexShrink: 0 }}>
              <div style={S.label}>Categories</div>
              <div style={S.sidebarItem(!selectedCat && !selectedProject && !selectedChapter)} onClick={() => { setSelectedCat(null); setSelectedProject(null); setSelectedChapter(null); }}>
                🗂️ All Notes
              </div>
              {categories.map(cat => (
                <div key={cat.id}>
                  <div style={S.sidebarItem(selectedCat === cat.id && !selectedProject)} onClick={() => { setSelectedCat(cat.id); setSelectedProject(null); setSelectedChapter(null); }}>
                    {cat.emoji} {cat.name}
                  </div>
                  {selectedCat === cat.id && projects.filter(p => p.category_id === cat.id).map(proj => (
                    <div key={proj.id}>
                      <div style={{ ...S.sidebarItem(selectedProject === proj.id && !selectedChapter), paddingLeft: 20 }} onClick={() => { setSelectedProject(proj.id); setSelectedChapter(null); }}>
                        📁 {proj.name}
                      </div>
                      {selectedProject === proj.id && chapters.filter(c => c.project_id === proj.id).map(chap => (
                        <div key={chap.id} style={{ ...S.sidebarItem(selectedChapter === chap.id), paddingLeft: 34 }} onClick={() => setSelectedChapter(chap.id)}>
                          📄 {chap.name}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Notes */}
            <div style={{ flex: 1 }}>
              <div style={S.label}>{filteredNotes.length} notes</div>
              {filteredNotes.length === 0 ? (
                <div style={{ color: "#444", fontSize: 13, marginTop: 40, textAlign: "center" }}>No notes here yet.</div>
              ) : filteredNotes.map(note => {
                const cat = categories.find(c => c.id === note.category_id);
                const proj = projects.find(p => p.id === note.project_id);
                const chap = chapters.find(c => c.id === note.chapter_id);
                return (
                  <div key={note.id} style={S.noteCard}>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "#d0c8b8", marginBottom: 6 }}>{note.text}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: "#c9a96e", fontFamily: "monospace" }}>
                        {cat?.emoji} {cat?.name || "Inbox"}{proj ? ` → ${proj.name}` : ""}{chap ? ` → ${chap.name}` : ""}
                      </span>
                      {(note.tags || []).map(t => <span key={t} style={S.tag}>#{t}</span>)}
                      <span style={{ fontSize: 10, color: "#333", fontFamily: "monospace", marginLeft: "auto" }}>
                        {new Date(note.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CHAT VIEW */}
        {view === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "70vh" }}>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 }}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={S.chatBubble(msg.role === "user")}>{msg.text}</div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: "flex", gap: 4, padding: "10px 14px" }}>
                  {[0,1,2].map(i => <div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#c9a96e",animation:"pulse 1.2s ease-in-out infinite",animationDelay:`${i*0.2}s` }} />)}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(); }}}
                placeholder="Ask anything from your notes..."
                rows={2}
                style={{ ...S.textarea, minHeight: 48, flex: 1 }}
              />
              <button style={S.btn(chatLoading || !chatInput.trim())} onClick={handleChat} disabled={chatLoading || !chatInput.trim()}>Ask</button>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:2px}textarea::placeholder{color:#333}`}</style>
    </div>
  );
}
