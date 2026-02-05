'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
}

interface ToolCall {
  name: string;
  arguments: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [serverUrl, setServerUrl] = useState('http://100.77.4.93:11236');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await sendAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      // Add user message
      const userMessage: Message = {
        role: 'user',
        content: '[Audio message]',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);

      // Create form data
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('system_prompt', systemPrompt);

      // Send to server
      const response = await fetch(`${serverUrl}/process-audio`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const data = await response.json();

      // Add assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.text || data.response || 'No response',
        audioUrl: data.audio_url,
        toolCalls: data.tool_calls,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Play audio response if available
      if (data.audio_url) {
        setAudioUrl(data.audio_url);
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (audioUrl && audioPlayerRef.current) {
      audioPlayerRef.current.src = audioUrl;
      audioPlayerRef.current.play();
    }
  }, [audioUrl]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
            Fun Audio Chat
          </h1>
          <p className="text-slate-300">Voice-enabled AI assistant with tool calling</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Settings Panel */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800/50 backdrop-blur-lg rounded-xl p-6 shadow-xl border border-slate-700">
              <h2 className="text-xl font-semibold mb-4">Settings</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Server URL</label>
                  <input
                    type="text"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-purple-500 focus:outline-none"
                    placeholder="http://100.77.4.93:11236"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">System Prompt</label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-purple-500 focus:outline-none resize-none"
                    placeholder="Enter system prompt..."
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Chat Panel */}
          <div className="lg:col-span-2">
            <div className="bg-slate-800/50 backdrop-blur-lg rounded-xl shadow-xl border border-slate-700 flex flex-col h-[600px]">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-slate-400 mt-20">
                    <p className="text-lg">No messages yet</p>
                    <p className="text-sm mt-2">Click the microphone to start talking</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-xl px-4 py-3 ${
                          msg.role === 'user'
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-700 text-slate-100'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">
                            {msg.role === 'user' ? 'You' : 'Assistant'}
                          </span>
                          <span className="text-xs opacity-60">
                            {msg.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm">{msg.content}</p>

                        {msg.audioUrl && (
                          <div className="mt-2">
                            <audio controls className="w-full h-8">
                              <source src={msg.audioUrl} type="audio/wav" />
                            </audio>
                          </div>
                        )}

                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-slate-600">
                            <p className="text-xs font-semibold mb-1">Tool Calls:</p>
                            {msg.toolCalls.map((tool, toolIdx) => (
                              <div key={toolIdx} className="text-xs bg-slate-800 rounded p-2 mt-1">
                                <span className="font-mono text-purple-300">{tool.name}</span>
                                <pre className="mt-1 text-slate-400 overflow-x-auto">
                                  {JSON.stringify(JSON.parse(tool.arguments), null, 2)}
                                </pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {isProcessing && (
                  <div className="flex justify-start">
                    <div className="bg-slate-700 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-sm text-slate-300">Processing...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="p-6 border-t border-slate-700">
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isProcessing}
                    className={`relative p-8 rounded-full transition-all duration-300 shadow-lg ${
                      isRecording
                        ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                        : 'bg-purple-600 hover:bg-purple-700 hover:scale-110'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <svg
                      className="w-8 h-8"
                      fill="white"
                      viewBox="0 0 24 24"
                    >
                      {isRecording ? (
                        <rect x="6" y="6" width="12" height="12" />
                      ) : (
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V20h4v2H8v-2h4v-4.07z" />
                      )}
                    </svg>
                  </button>

                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {isRecording ? 'Recording...' : isProcessing ? 'Processing...' : 'Ready'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {isRecording ? 'Click to stop' : 'Click to start'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden audio player for automatic playback */}
      <audio ref={audioPlayerRef} className="hidden" />
    </div>
  );
}
