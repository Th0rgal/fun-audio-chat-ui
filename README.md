# Fun Audio Chat - Web Client

A Next.js web interface for interacting with the Fun-Audio-Chat AI model running on DGX Spark.

**🚀 Live Demo**: https://fun-audio-chat-ui.vercel.app

## Features

- 🎙️ **Real-time Audio Recording**: Click-to-record voice messages
- 🔊 **Audio Playback**: Automatic playback of AI responses
- 💬 **Conversation History**: Full message threading with timestamps
- 🔧 **Tool Call Visualization**: See what functions the AI calls
- ⚙️ **Configurable Settings**: Custom server URL and system prompts
- 🎨 **Modern UI**: Beautiful gradient design with smooth animations

## Quick Start

### Option 1: Use the Live Deployment

Visit **https://fun-audio-chat-ui.vercel.app** and configure the server URL in settings.

### Option 2: Run Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start development server**:
   ```bash
   npm run dev
   ```

3. **Open in browser**:
   ```
   http://localhost:3000
   ```

4. **Configure server**:
   - In the Settings panel, set Server URL to: `http://100.77.4.93:11236`
   - Customize the system prompt if desired

5. **Start chatting**:
   - Click the microphone button to start recording
   - Speak your message
   - Click again to stop recording
   - Wait for the AI response (text + audio)

## Configuration

### Server URL
The default server URL points to the DGX Spark instance:
```
http://100.77.4.93:11236
```

Make sure:
- You're connected to the Tailscale network
- The Fun-Audio-Chat server is running on DGX Spark
- Port 11236 is accessible

### System Prompts

You can customize the AI's behavior with different system prompts:

**Default (Conversational)**:
```
You are a helpful assistant.
```

**Technical Expert**:
```
You are a technical expert who provides detailed, accurate explanations.
```

## Troubleshooting

### "Cannot access microphone"
- Check browser permissions
- Ensure HTTPS if using Safari
- Try different browser

### "Server error" messages
- Verify server is running: `curl http://100.77.4.93:11236/health`
- Check network connectivity to DGX Spark
- Review server logs on DGX Spark

### No audio playback
- Check browser console for errors
- Verify audio URLs are accessible

## Deployment

The app is automatically deployed to Vercel on every push to the main branch.

**Production URL**: https://fun-audio-chat-ui.vercel.app

### Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Th0rgal/fun-audio-chat-ui)

Or manually:
```bash
vercel --prod
```

## Related Documentation

- [Main Setup Guide](https://github.com/Th0rgal/fun-audio-chat-setup)
- [Fun-Audio-Chat GitHub](https://github.com/FunAudioLLM/Fun-Audio-Chat)
