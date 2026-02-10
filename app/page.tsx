'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
}

interface ToolCall {
  id?: string;
  name: string;
  arguments: string;
}

interface StreamEvent {
  type?: string;
  delta?: string;
  content?: string;
  text?: string;
  audio_url?: string;
  url?: string;
  name?: string;
  arguments?: string;
  tool_call?: ToolCall;
  tool_calls?: ToolCall[];
  error?: string;
  choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
}

const defaultServerUrl =
  process.env.NEXT_PUBLIC_DEFAULT_SERVER_URL ||
  'https://spark-de79.gazella-vector.ts.net';

const settingsStorageKey = 'fun-audio-chat-settings';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [streamPath, setStreamPath] = useState('/process-audio-stream');
  const [modelId, setModelId] = useState('');
  const [voicePromptFile, setVoicePromptFile] = useState<File | null>(null);
  const [toolsJson, setToolsJson] = useState('[\n  {\n    "name": "get_weather",\n    "description": "Get the current weather for a city",\n    "parameters": {\n      "type": "object",\n      "properties": {\n        "city": { "type": "string" }\n      },\n      "required": ["city"]\n    }\n  }\n]');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isRecordingRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const autoStopSilenceMs = 1200;
  const silenceThreshold = 0.015;

  const stopSilenceDetection = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    silenceStartRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  const startSilenceDetection = (stream: MediaStream) => {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.fftSize);
      const check = () => {
        if (!analyserRef.current || !mediaRecorderRef.current || !isRecordingRef.current) {
          return;
        }
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const normalized = (data[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = Date.now();

        if (rms < silenceThreshold) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current > autoStopSilenceMs) {
            stopRecording();
            return;
          }
        } else {
          silenceStartRef.current = null;
        }

        rafRef.current = requestAnimationFrame(check);
      };

      rafRef.current = requestAnimationFrame(check);
    } catch (error) {
      console.warn('Silence detection disabled:', error);
    }
  };

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
        stopSilenceDetection();
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      startSilenceDetection(stream);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Could not access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      isRecordingRef.current = false;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sanitizeServerUrl = (value: string | undefined | null) => {
    if (!value) {
      return defaultServerUrl;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultServerUrl;
    }
    if (trimmed.startsWith('http://100.77.4.93') || trimmed.startsWith('https://100.77.4.93')) {
      return defaultServerUrl;
    }
    return trimmed;
  };

  const resolveAudioUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${serverUrl.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const formatToolArgs = (args: string) => {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  };

  const appendAssistantDelta = (messageId: string, delta: string) => {
    setMessages(prev =>
      prev.map(msg => (msg.id === messageId ? { ...msg, content: msg.content + delta } : msg))
    );
  };

  const upsertToolCall = (messageId: string, toolCall: ToolCall) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== messageId) {
          return msg;
        }
        const existing = msg.toolCalls || [];
        if (toolCall.id) {
          const index = existing.findIndex(call => call.id === toolCall.id);
          if (index >= 0) {
            const updated = [...existing];
            updated[index] = {
              ...updated[index],
              name: toolCall.name || updated[index].name,
              arguments: `${updated[index].arguments || ''}${toolCall.arguments || ''}`,
            };
            return { ...msg, toolCalls: updated };
          }
        }
        return { ...msg, toolCalls: [...existing, toolCall] };
      })
    );
  };

  const handleStreamEvent = (messageId: string, event: StreamEvent) => {
    if (event.error) {
      appendAssistantDelta(messageId, `\n[Error] ${event.error}`);
      return;
    }

    const textDelta = event.delta || event.content || event.text;
    if (textDelta) {
      appendAssistantDelta(messageId, textDelta);
    }

    if (event.audio_url || event.url) {
      const resolvedUrl = resolveAudioUrl(event.audio_url || event.url || '');
      setAudioUrl(resolvedUrl);
      setMessages(prev =>
        prev.map(msg => (msg.id === messageId ? { ...msg, audioUrl: resolvedUrl } : msg))
      );
    }

    if (event.tool_call) {
      upsertToolCall(messageId, {
        id: event.tool_call.id,
        name: event.tool_call.name || 'tool',
        arguments: event.tool_call.arguments || '',
      });
    }

    if (event.tool_calls && event.tool_calls.length > 0) {
      event.tool_calls.forEach(tool =>
        upsertToolCall(messageId, {
          id: tool.id,
          name: tool.name || 'tool',
          arguments: tool.arguments || '',
        })
      );
    }

    if (event.choices && event.choices.length > 0) {
      event.choices.forEach(choice => {
        const delta = choice.delta;
        if (delta?.content) {
          appendAssistantDelta(messageId, delta.content);
        }
        if (delta?.tool_calls) {
          delta.tool_calls.forEach(call => {
            upsertToolCall(messageId, {
              id: call.id,
              name: call.function?.name || 'tool',
              arguments: call.function?.arguments || '',
            });
          });
        }
      });
    }
  };

  const parseStreamChunks = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    messageId: string,
    contentType: string
  ) => {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const isSse = contentType.includes('text/event-stream');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const payload = isSse && trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        if (payload === '[DONE]') {
          return;
        }
        try {
          const event = JSON.parse(payload) as StreamEvent;
          handleStreamEvent(messageId, event);
        } catch {
          if (!isSse) {
            appendAssistantDelta(messageId, payload);
          }
        }
      }
    }
  };

  const sendAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    let assistantMessageId: string | null = null;

    try {
      let parsedTools: unknown = null;
      if (toolsJson.trim().length > 0) {
        try {
          parsedTools = JSON.parse(toolsJson);
        } catch {
          throw new Error('Tools JSON is invalid. Please fix the JSON format.');
        }
      }

      const messageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      assistantMessageId = messageId;

      // Add user message
      const userMessage: Message = {
        id: `${Date.now()}-user-${Math.random().toString(16).slice(2)}`,
        role: 'user',
        content: '[Audio message]',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);

      const assistantMessage: Message = {
        id: messageId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Create form data
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('system_prompt', systemPrompt);
      if (modelId.trim().length > 0) {
        formData.append('model', modelId.trim());
      }
      if (voicePromptFile) {
        formData.append('voice_prompt', voicePromptFile);
      }
      if (parsedTools) {
        formData.append('tools', JSON.stringify(parsedTools));
      }

      if (streamingEnabled) {
        const response = await fetch(`${serverUrl.replace(/\/$/, '')}${streamPath}`, {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream, application/x-ndjson, application/json',
          },
          body: formData,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Server error: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const reader = response.body.getReader();
        await parseStreamChunks(reader, messageId, contentType);
      } else {
        const response = await fetch(`${serverUrl.replace(/\/$/, '')}/process-audio`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.statusText}`);
        }

        const data = await response.json();

        setMessages(prev =>
          prev.map(msg =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: data.text || data.response || 'No response',
                  audioUrl: data.audio_url ? resolveAudioUrl(data.audio_url) : undefined,
                  toolCalls: data.tool_calls || [],
                }
              : msg
          )
        );

        if (data.audio_url) {
          setAudioUrl(resolveAudioUrl(data.audio_url));
        }
      }
    } catch (error) {
      console.error('Error processing audio:', error);
      const baseError = error instanceof Error ? error.message : 'Unknown error';
      const errorText =
        baseError === 'Failed to fetch'
          ? 'Error: Failed to fetch. This usually means the server is unreachable or CORS is blocked. Verify the Server URL and that the DGX server allows your origin.'
          : `Error: ${baseError}`;
      if (assistantMessageId) {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: errorText, toolCalls: msg.toolCalls || [] }
              : msg
          )
        );
      } else {
        const errorMessage: Message = {
          id: `${Date.now()}-error-${Math.random().toString(16).slice(2)}`,
          role: 'assistant',
          content: errorText,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
      }
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.localStorage.getItem(settingsStorageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Partial<{
        serverUrl: string;
        systemPrompt: string;
        streamingEnabled: boolean;
        streamPath: string;
        modelId: string;
        toolsJson: string;
      }>;
      if (parsed.serverUrl) {
        const sanitized = sanitizeServerUrl(parsed.serverUrl);
        setServerUrl(sanitized);
      }
      if (parsed.systemPrompt) {
        setSystemPrompt(parsed.systemPrompt);
      }
      if (typeof parsed.streamingEnabled === 'boolean') {
        setStreamingEnabled(parsed.streamingEnabled);
      }
      if (parsed.streamPath) {
        setStreamPath(parsed.streamPath);
      }
      if (parsed.modelId) {
        setModelId(parsed.modelId);
      }
      if (parsed.toolsJson) {
        setToolsJson(parsed.toolsJson);
      }
    } catch {
      // Ignore malformed local storage settings.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const payload = {
      serverUrl,
      systemPrompt,
      streamingEnabled,
      streamPath,
      modelId,
      toolsJson,
    };
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(payload));
  }, [serverUrl, systemPrompt, streamingEnabled, streamPath, modelId, toolsJson]);

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
                    placeholder="https://spark-de79.gazella-vector.ts.net"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Streaming</label>
                  <button
                    onClick={() => setStreamingEnabled(prev => !prev)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      streamingEnabled ? 'bg-green-500/20 text-green-200' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {streamingEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {streamingEnabled && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Streaming Path</label>
                    <input
                      type="text"
                      value={streamPath}
                      onChange={(e) => setStreamPath(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-purple-500 focus:outline-none"
                      placeholder="/process-audio-stream"
                    />
                  </div>
                )}

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

                <div>
                  <label className="block text-sm font-medium mb-2">Model ID (optional)</label>
                  <input
                    type="text"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-purple-500 focus:outline-none"
                    placeholder="nvidia/personaplex-7b-v1"
                  />
                  <p className="text-xs text-slate-400 mt-1">Sent as form field: model</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Voice Prompt (optional)</label>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setVoicePromptFile(e.target.files?.[0] || null)}
                    className="w-full text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-200 hover:file:bg-slate-600"
                  />
                  <p className="text-xs text-slate-400 mt-1">Sent as form field: voice_prompt</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Tools (JSON)</label>
                  <textarea
                    value={toolsJson}
                    onChange={(e) => setToolsJson(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 bg-slate-700 rounded-lg border border-slate-600 focus:border-purple-500 focus:outline-none resize-none font-mono text-xs"
                    placeholder='[{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}]'
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
                  messages.map((msg) => (
                    <div
                      key={msg.id}
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
                                  {formatToolArgs(tool.arguments)}
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
