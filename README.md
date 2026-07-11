# AI Super Assistant — Core Chat & Advanced Agent Intelligence

This is your AI Super Assistant: a powerful chatbot interface running in your browser, powered by Google's Gemini API, complete with session memory, secure accounts, web search capability, document understanding, and voice features.

## Main Features

1. **User Authentication & Accounts**:
   - Secure sign-up and log-in system using SQLite and bcrypt for hashed password storage.
   - Separate, persistent conversation history for each registered user account.

2. **Persistent Conversation History**:
   - Chat histories are saved automatically.
   - The left sidebar displays the **4 most recent conversations** dynamically.
   - The "Saved Chats" history block remains completely hidden if you have 0 chats, appearing instantly when you send your first message.
   - Double-click any saved chat item in the sidebar to rename it inline.

3. **Web Search Grounding**:
   - Toggle "Enable Web Search" in the sidebar.
   - Let the assistant perform real-time searches to answer current facts, complete with domain source citations and grounding metadata.

4. **Document Q&A Context**:
   - Drag and drop a PDF or text file anywhere on the chat area, or click the file upload clip icon next to the chat bar to attach a document.
   - The assistant parses the document and uses it as current context so you can query its text.

   - Use the microphone button in the input bar to type your questions hands-free.
   - Enable "Autoplay Spoken Replies" to hear synthesized speech read back assistant answers, or click "Listen" manually on any message.

---

## Setup & Running (5 minutes)

### 1. Configure API Key
Create a `.env` file in the root directory (based on `.env.example`) and add your Google Gemini API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Install Dependencies
Run the following command to download Node.js packages:
```bash
npm install
```

### 3. Run the Chatbot
Start the local server using Node:
```bash
node server.js
```
The server will boot and connect to `db.sqlite`.

### 4. Chat!
Open [http://localhost:3000](http://localhost:3000) in your web browser. 
- Use the **Sign In / Sign Up** button in the sidebar footer or the top-right header corner to log into your account and access persistent saved chats.
