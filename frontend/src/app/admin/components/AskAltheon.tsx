"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";

const API_BASE = "https://altheon-platform.onrender.com";
const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

const SUGGESTIONS = [
  "How many appointments today?",
  "What's billed this month?",
  "How many open PI cases?",
] as const;

export default function AskAltheon() {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, isOpen, scrollToBottom]);

  const submitQuestion = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setQuestion("");
    setLoading(true);

    let answer =
      "I couldn't retrieve that data right now. Please try again.";
    try {
      const res = await fetch(`${API_BASE}/ask-altheon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          clinic_id: CLINIC_ID,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        answer?: string;
      } | null;
      if (data && typeof data.answer === "string" && data.answer.trim()) {
        answer = data.answer.trim();
      }
    } catch {
      // keep fallback answer
    } finally {
      setLoading(false);
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    }
  }, [loading]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitQuestion(question);
  }

  return (
    <>
      <button
        type="button"
        title="Ask Altheon"
        aria-label="Ask Altheon"
        onClick={() => setIsOpen((o) => !o)}
        className={[
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#1a6b3c] text-white shadow-lg transition-shadow hover:shadow-xl",
          !isOpen && messages.length === 0 ? "animate-pulse" : "",
        ].join(" ")}
      >
        <Sparkles className="h-6 w-6 shrink-0" aria-hidden />
      </button>

      {isOpen ? (
        <div
          className="fixed bottom-24 right-6 z-50 flex w-80 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl md:w-96"
          role="dialog"
          aria-label="Ask Altheon chat"
        >
          <div className="rounded-t-2xl bg-[#1a6b3c] px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Sparkles className="h-5 w-5 shrink-0 text-white" aria-hidden />
                <div className="min-w-0">
                  <div className="font-semibold text-white">Ask Altheon</div>
                  <p className="text-xs text-green-100">
                    Ask me about your clinic data
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-white transition-colors hover:bg-white/10"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>

          <div className="h-72 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <>
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800">
                    Hi! I&apos;m Altheon AI. Ask me anything about your
                    appointments, billing, patients, or cases.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setQuestion(s);
                        void submitQuestion(s);
                      }}
                      className="cursor-pointer rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-[#1a6b3c] hover:text-[#1a6b3c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}-${m.content.slice(0, 24)}`}
                className={
                  m.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[#1a6b3c] px-3 py-2 text-sm text-white"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading ? (
              <div className="flex justify-start">
                <div className="flex max-w-[85%] items-center gap-1 rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3 text-sm text-gray-600">
                  <span
                    className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-500"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-500"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="inline-block h-2 w-2 animate-bounce rounded-full bg-gray-500"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            ) : null}

            <div ref={scrollAnchorRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-gray-100 p-3"
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about your clinic..."
                disabled={loading}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#1a6b3c] focus:outline-none focus:ring-1 focus:ring-[#1a6b3c] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !question.trim()}
                className="flex shrink-0 items-center justify-center rounded-xl bg-[#1a6b3c] px-3 py-2 text-white transition-opacity disabled:opacity-50"
                aria-label="Send"
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
