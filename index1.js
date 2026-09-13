import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import dotenv from "dotenv";
import fs from "fs/promises";
import puppeteer from "puppeteer";
import { exec } from "child_process";
import util from "util";
import readline from "readline/promises";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

dotenv.config();
const pool = new Pool({
  connectionString: `postgresql://${process.env.user}:${process.env.password}@localhost:5432/my_agent_db`,
});
const checkpointer = new PostgresSaver(pool);
await checkpointer.setup(); 

const execPromise = util.promisify(exec);

// 1. Initialize the LangChain Model
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  apiKey: process.env.GEMINI_API_KEY,
  maxRetries: 6,
});

// 2. Wrap all Javascript functions in LangChain's tool() wrapper

const readFileTool = tool(
  async ({ filePath }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      if (lines.length > 5)
        return `Error: The file '${filePath}' is too massive (${lines.length} lines). Reading it will crash the system. Please use the 'searchInFile' tool instead to find the specific information you need!`;
      return content;
    } catch (error) {
      return `Error reading file: ${error.message}`;
    }
  },
  {
    name: "readFile",
    description: "Reads the text content of a file on the computer.",
    schema: z.object({
      filePath: z.string().describe("The path to the file to read"),
    }),
  },
);

const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      await fs.writeFile(filePath, content, "utf-8");
      return `Success! Wrote to file at ${filePath}`;
    } catch (error) {
      return `Error creating file : ${error.message}`;
    }
  },
  {
    name: "writeFile",
    description:
      "Creates a new file OR overwrites an existing file with new content.",
    schema: z.object({
      filePath: z.string().describe("The path of the file to create or modify"),
      content: z
        .string()
        .describe("The complete, updated text to write inside the file"),
    }),
  },
);

const listFilesTool = tool(
  async ({ directoryPath }) => {
    try {
      const files = await fs.readdir(directoryPath, { recursive: true });
      return files.join("\n");
    } catch (error) {
      return `Error listing files: ${error.message}`;
    }
  },
  {
    name: "listFiles",
    description: "Lists all files and folders inside a given directory.",
    schema: z.object({
      directoryPath: z
        .string()
        .describe(
          "The path of the folder to list (use '.' for the current main folder)",
        ),
    }),
  },
);

const searchInFileTool = tool(
  async ({ filePath, keyword }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      let results = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(keyword.toLowerCase())) {
          results.push(`Line ${i + 1}: ${lines[i].trim()}`);
        }
      }
      if (results.length === 0) return `No matches found for '${keyword}'.`;
      return results.slice(0, 50).join("\n");
    } catch (error) {
      return `Error searching file: ${error.message}`;
    }
  },
  {
    name: "searchInFile",
    description:
      "Searches inside a file for a specific keyword and returns the matching lines and line numbers. Use this on large files instead of readFile to save context space.",
    schema: z.object({
      filePath: z.string(),
      keyword: z.string().describe("The word or variable name to search for"),
    }),
  },
);

const replaceLinesInFileTool = tool(
  async ({ filePath, startLine, endLine, replacementText }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const startIndex = startLine - 1;
      const endIndex = endLine - 1;
      if (startIndex < 0 || endIndex >= lines.length || startIndex > endIndex) {
        return `Error: Invalid line numbers. The file only has ${lines.length} lines!`;
      }
      lines.splice(startIndex, endIndex - startIndex + 1, replacementText);
      await fs.writeFile(filePath, lines.join("\n"), "utf-8");
      return `Success! Replaced lines ${startLine} to ${endLine} in ${filePath}.`;
    } catch (error) {
      return `Error editing file: ${error.message}`;
    }
  },
  {
    name: "replaceLinesInFile",
    description:
      "Replaces a specific range of lines in a file with new code. ALWAYS use searchInFile first to find the exact line numbers before using this tool!",
    schema: z.object({
      filePath: z.string(),
      startLine: z.number().describe("The starting line number to replace"),
      endLine: z
        .number()
        .describe(
          "The ending line number to replace (can be the same as startLine if replacing just 1 line)",
        ),
      replacementText: z
        .string()
        .describe("The new code or text to insert in that exact spot"),
    }),
  },
);

const createGitHubRepoTool = tool(
  async ({ repoName }) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return "Error: GITHUB_TOKEN not found in .env";
    try {
      const response = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: repoName, private: false }),
      });
      const data = await response.json();
      if (!response.ok) return `GitHub API Error: ${data.message}`;
      return `Success! Created repository. The git remote URL is: https://${token}@github.com/${data.full_name}.git`;
    } catch (error) {
      return `Error: ${error.message}`;
    }
  },
  {
    name: "createGitHubRepo",
    description:
      "Creates a new public repository on GitHub and returns the clone URL.",
    schema: z.object({
      repoName: z
        .string()
        .describe(
          "The name of the repository to create (use hyphens instead of spaces)",
        ),
    }),
  },
);

const runTerminalCommandTool = tool(
  async ({ command }) => {
    try {
      const { stdout, stderr } = await execPromise(command);
      if (stderr)
        return `Command ran with warnings: ${stderr}\nOutput: ${stdout}`;
      return stdout || "Command executed successfully with no text output.";
    } catch (error) {
      return `Command failed: ${error.message}`;
    }
  },
  {
    name: "runTerminalCommand",
    description:
      "Executes a terminal/command-prompt command on the computer. Highly useful for running git commands, npm installs, or starting servers.",
    schema: z.object({
      command: z
        .string()
        .describe(
          "The exact terminal command to execute (e.g., 'git init' or 'git push -u origin main')",
        ),
    }),
  },
);

const checkInstagramTool = tool(
  async () => {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: false,
        userDataDir: "./my_chrome_data", // Uses your saved login!
      });
      const page = await browser.newPage();
      console.log("🎬 Going to Instagram Reels...");
      await page.goto("https://www.instagram.com/reels/", {
        waitUntil: "networkidle2",
      });

      for (let i = 1; i <= 5; i++) {
        console.log(`👀 Watching Reel #${i}...`);
        await page.waitForSelector("video");
        await page.evaluate(() => {
          return new Promise((resolve) => {
            const videos = document.querySelectorAll("video");
            const activeVideo =
              Array.from(videos).find((v) => !v.paused) || videos[0];
            if (!activeVideo) {
              setTimeout(resolve, 5000);
              return;
            }
            const checkTime = () => {
              if (activeVideo.currentTime / activeVideo.duration > 0.95) {
                activeVideo.removeEventListener("timeupdate", checkTime);
                resolve();
              }
            };
            activeVideo.addEventListener("timeupdate", checkTime);
            setTimeout(resolve, 30000);
          });
        });
        console.log("⬇️ Reel finished! Scrolling down...");
        await page.keyboard.press("ArrowDown");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      await browser.close();
      return `Successfully watched 5 reels!`;
    } catch (error) {
      if (browser) await browser.close();
      return `Error watching reels: ${error.message}`;
    }
  },
  {
    name: "checkInstagram",
    description:
      "Opens a web browser, logs into Instagram using environment credentials, and navigates to the user's profile.",
    schema: z.object({}), // No arguments needed!
  },
);

// 3. Define System Instructions
const systemInstruction = `You are an expert AI Software Engineer. Obey these rules strictly:
1. Do not explore extra files unnecessarily.
2. If asked to push to GitHub, NEVER use the 'gh' CLI tool. Use standard git commands.
3. NEVER use Python. Use Node.js for terminal scripts.`;

// 4. Build the Agent Engine
// THIS COMPLETELY REPLACES YOUR INFINITE WHILE LOOP AND IF/ELSE BLOCKS!
const agent = createReactAgent({
  llm,
  tools: [
    readFileTool,
    writeFileTool,
    listFilesTool,
    searchInFileTool,
    replaceLinesInFileTool,
    createGitHubRepoTool,
    runTerminalCommandTool,
    checkInstagramTool,
  ],
  messageModifier: systemInstruction,
  checkpointSaver: checkpointer,
  interruptBefore: ['tools']
});

// 5. Run the System
async function main() {
  console.log("🚀 STARTING THE LANGGRAPH AGENT (STREAMING + HITL)!!!");
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config = { configurable: { thread_id: "demo-thread-2" } };

  // Helper function to handle streaming output
  async function processStream(input) {
    const stream = await agent.stream(input, config);
    for await (const chunk of stream) {
      // chunk is an object with a key representing the node that just finished (e.g., 'agent' or 'tools')
      const nodeName = Object.keys(chunk)[0];
      console.log(`\n[Stream Event]: The '${nodeName}' node just finished!`);
    }
  }

  // 1. Start the agent stream. It will pause as soon as it decides to use a tool.
  await processStream({
    messages: [
      ["user", "push to git the current changes"]
    ]
  });

  // 2. Loop to handle multiple tool pauses!
  let state = await agent.getState(config);
  
  // As long as the agent keeps pausing to ask for tools, we keep asking you!
  while (state.next && state.next.includes("tools")) {
    const lastMessage = state.values.messages[state.values.messages.length - 1];
    
    console.log("\n🛑 ------------------------------------------- 🛑");
    console.log("🛑 AGENT PAUSED! It wants to run these tools:");
    console.log(JSON.stringify(lastMessage.tool_calls, null, 2));
    console.log("🛑 ------------------------------------------- 🛑\n");

    const answer = await rl.question("🟢 Do you approve this action? (y/n): ");
    
    if (answer.toLowerCase().startsWith('y')) {
      console.log("\n✅ Action Approved! Resuming Agent Stream...\n");
      // Passing 'null' tells the agent to resume streaming exactly where it left off
      await processStream(null); 
      
      // Update the state so the while loop knows if it paused again!
      state = await agent.getState(config);
    } else {
      console.log("\n❌ Action Rejected! Exiting...\n");
      rl.close();
      return; 
    }
  }

  // Fetch the final state to print the final AI text answer
  state = await agent.getState(config);
  const finalMessage = state.values.messages[state.values.messages.length - 1];
  console.log("\n🤖 Agent's Final Answer:\n", finalMessage.content);
  
  rl.close();
}

main();
