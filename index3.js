import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StateGraph, MessagesAnnotation, END, START } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();
const checkpointer = new MemorySaver();

// 1. Initialize the Model
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  apiKey: process.env.GEMINI_API_KEY,
});

// ==========================================
// 2. DEFINE THE NODES (The Agents)
// ==========================================

// Agent 1: The Coder
async function coderNode(state) {
  console.log("👨‍💻 Coder is writing/fixing code...");
  
  // 1. Grab the original request
  const originalRequest = state.messages[0].content;
  let promptText = `Solve this request: ${originalRequest}\n\nONLY output the code and brief explanation.`;
  
  // 2. If the graph looped, grab the feedback from the Reviewer!
  if (state.messages.length > 1) {
    const reviewerFeedback = state.messages[state.messages.length - 1].content;
    promptText += `\n\nTHE REVIEWER REJECTED YOUR LAST ATTEMPT WITH THIS FEEDBACK:\n${reviewerFeedback}\n\nPlease fix the code!`;
  }

  // 3. Build a clean message for Gemini
  const messages = [
    new SystemMessage("You are an expert Javascript coder."),
    new HumanMessage(promptText)
  ];
  
  const response = await llm.invoke(messages);
  return { messages: [response] }; 
}

// Agent 2: The Reviewer
async function reviewerNode(state) {
  console.log("🕵️‍♂️ Reviewer is checking the code...");
  
  // Grab the code the Coder just wrote
  const codeToReview = state.messages[state.messages.length - 1].content;
  
  // Build a clean message for Gemini
  const messages = [
    new SystemMessage("You are a strict, senior code reviewer. If the code is perfect, reply EXACTLY with the word 'APPROVED'. If it has bugs, tell the coder to fix it."),
    new HumanMessage(`Please review this code:\n\n${codeToReview}`)
  ];
  
  const response = await llm.invoke(messages);
  return { messages: [response] };
}


// ==========================================
// 3. DEFINE THE CONDITIONAL EDGE (The Logic)
// ==========================================

function reviewRouter(state) {
  const lastMessage = state.messages[state.messages.length - 1].content;
  
  if (lastMessage.includes("APPROVED")) {
    console.log("✅ Reviewer approved the code! Finishing task...");
    return END; 
  } else {
    console.log("❌ Reviewer found bugs! Sending back to Coder...");
    return "coder"; 
  }
}


// ==========================================
// 4. BUILD THE GRAPH (The Workflow)
// ==========================================

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("coder", coderNode)
  .addNode("reviewer", reviewerNode)
  .addEdge(START, "coder") 
  .addEdge("coder", "reviewer") 
  .addConditionalEdges("reviewer", reviewRouter);

// Compile the Graph into a runnable application (WITH MEMORY AND HITL)
const multiAgentApp = workflow.compile({
  checkpointer: checkpointer,
  interruptBefore: ["reviewer"]
});


// ==========================================
// 5. RUN THE MULTI-AGENT SWARM
// ==========================================

async function main() {
  console.log("🚀 STARTING THE MULTI-AGENT SWARM (WITH HITL)!!!\n");
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = { configurable: { thread_id: "multi-agent-demo" } };

  // Helper function to stream output
  async function processStream(input) {
    const stream = await multiAgentApp.stream(input, config);
    for await (const chunk of stream) {
      const nodeName = Object.keys(chunk)[0];
      
      // Handle the interrupt node which doesn't have messages
      if (nodeName === "__interrupt__") continue;
      
      const message = chunk[nodeName].messages[0].content;
      
      console.log(`\n=========================================`);
      console.log(`[${nodeName.toUpperCase()} FINISHED] Output:`);
      console.log(message);
      console.log(`=========================================\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // 1. Give the initial task
  await processStream({
    messages: [new HumanMessage("Write a Javascript function that calculates the Fibonacci sequence up to N numbers.")]
  });

  // 2. The HITL Loop
  let state = await multiAgentApp.getState(config);
  
  // Keep asking for permission as long as the graph is paused before the Reviewer!
  while (state.next && state.next.includes("reviewer")) {
    console.log("🛑 ------------------------------------------- 🛑");
    console.log("🛑 MANAGER PAUSE: The Coder wants to send this code to the Reviewer.");
    console.log("🛑 ------------------------------------------- 🛑\n");

    const answer = await rl.question("🟢 Do you approve sending it to the Reviewer? (y/n): ");
    
    if (answer.toLowerCase().startsWith('y')) {
      console.log("\n✅ Approved! Resuming Swarm...\n");
      await processStream(null); 
      // Update state for the next loop!
      state = await multiAgentApp.getState(config); 
    } else {
      console.log("\n❌ Action Rejected! Exiting...\n");
      rl.close();
      return; 
    }
  }
  
  console.log("\n🎉 The Multi-Agent Swarm has finished the task!");
  rl.close();
}

main();
