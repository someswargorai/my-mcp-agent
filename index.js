import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs/promises";
import puppeteer from "puppeteer";
import { exec } from "child_process";
import util from "util";
const execPromise = util.promisify(exec);

dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function readFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // Count how many lines are in the file
    const lines = content.split("\n");

    // THE GUARDRAIL: If it's too big, reject the AI's request!
    if (lines.length > 5) {
      return `Error: The file '${filePath}' is too massive (${lines.length} lines). Reading it will crash the system. Please use the 'searchInFile' tool instead to find the specific information you need!`;
    }

    return content;
  } catch (error) {
    return `Error reading file: ${error.message}`;
  }
}

async function checkMyInstagramProfile() {
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

    // Loop 5 times to watch 5 different reels
    for (let i = 1; i <= 5; i++) {
      console.log(`👀 Watching Reel #${i}...`);

      // Wait for a video to appear on the screen
      await page.waitForSelector("video");

      // 🧠 THE CLEVER TRICK: We inject code directly into the browser to watch the video's clock!
      await page.evaluate(() => {
        return new Promise((resolve) => {
          // Find the video that is currently playing on the screen
          const videos = document.querySelectorAll("video");
          const activeVideo =
            Array.from(videos).find((v) => !v.paused) || videos[0];

          if (!activeVideo) {
            setTimeout(resolve, 5000); // If no video found, just wait 5 seconds
            return;
          }
          // Check the clock every time the video updates
          const checkTime = () => {
            // If the video has played past 95% of its total length...
            if (activeVideo.currentTime / activeVideo.duration > 0.95) {
              activeVideo.removeEventListener("timeupdate", checkTime);
              resolve(); // We are done watching!
            }
          };

          activeVideo.addEventListener("timeupdate", checkTime);

          // Fallback: If a reel is super long, force skip it after 30 seconds
          setTimeout(resolve, 30000);
        });
      });

      console.log("⬇️ Reel finished! Scrolling down...");
      // Simulate pressing the Down Arrow key to scroll to the next reel!
      await page.keyboard.press("ArrowDown");

      // Wait 2 seconds for the new reel to load and start playing
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await browser.close();
    return `Successfully watched 5 reels!`;
  } catch (error) {
    if (browser) await browser.close();
    return `Error watching reels: ${error.message}`;
  }
}

async function listFiles(directoryPath = ".") {
  try {
    // recursive: true tells it to look inside all sub-folders too!
    const files = await fs.readdir(directoryPath, { recursive: true });
    return files.join("\n");
  } catch (error) {
    return `Error listing files: ${error.message}`;
  }
}

async function writeFile(filePath, content) {
  try {
    await fs.writeFile(filePath, content, "utf-8");
    return `Success! Wrote to file at ${filePath}`;
  } catch (error) {
    return `Error creating file : ${error.message}`;
  }
}

async function createGitHubRepo(repoName) {
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
      body: JSON.stringify({
        name: repoName,
        private: false,
      }),
    });

    const data = await response.json();
    if (!response.ok) return `GitHub API Error: ${data.message}`;

    const authenticatedUrl = `https://${token}@github.com/${data.full_name}.git`;
   
    return `Success! Created repository. The git remote URL is: ${authenticatedUrl}`;
  } catch (error) {
    return `Error connecting to GitHub: ${error.message}`;
  }
}

async function runTerminalCommand(command) {
  try {
    const { stdout, stderr } = await execPromise(command);
    if (stderr)
      return `Command ran, but with warnings: ${stderr}\nOutput: ${stdout}`;
    return stdout || "Command executed successfully with no text output.";
  } catch (error) {
    return `Command failed: ${error.message}`;
  }
}

async function searchInFile(filePath, keyword) {
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
}

async function replaceLinesInFile(
  filePath,
  startLine,
  endLine,
  replacementText,
) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    // Arrays start at 0, but line numbers start at 1, so we adjust them
    const startIndex = startLine - 1;
    const endIndex = endLine - 1;

    // Guardrail: Make sure the AI didn't hallucinate fake line numbers
    if (startIndex < 0 || endIndex >= lines.length || startIndex > endIndex) {
      return `Error: Invalid line numbers. The file only has ${lines.length} lines!`;
    }
    lines.splice(startIndex, endIndex - startIndex + 1, replacementText);

    await fs.writeFile(filePath, lines.join("\n"), "utf-8");
    return `Success! Replaced lines ${startLine} to ${endLine} in ${filePath}.`;
  } catch (error) {
    return `Error editing file: ${error.message}`;
  }
}

const replaceLinesToolDeclaration = {
  name: "replaceLinesInFile",
  description:
    "Replaces a specific range of lines in a file with new code. ALWAYS use searchInFile first to find the exact line numbers before using this tool!",
  parameters: {
    type: "OBJECT",
    properties: {
      filePath: { type: "STRING" },
      startLine: {
        type: "INTEGER",
        description: "The starting line number to replace",
      },
      endLine: {
        type: "INTEGER",
        description:
          "The ending line number to replace (can be the same as startLine if replacing just 1 line)",
      },
      replacementText: {
        type: "STRING",
        description: "The new code or text to insert in that exact spot",
      },
    },
    required: ["filePath", "startLine", "endLine", "replacementText"],
  },
};

const listFilesToolDeclaration = {
  name: "listFiles",
  description: "Lists all files and folders inside a given directory.",
  parameters: {
    type: "OBJECT",
    properties: {
      directoryPath: {
        type: "STRING",
        description:
          "The path of the folder to list (use '.' for the current main folder)",
      },
    },
    required: ["directoryPath"],
  },
};

const createGitHubRepoToolDeclaration = {
  name: "createGitHubRepo",
  description:
    "Creates a new private repository on GitHub and returns the clone URL.",
  parameters: {
    type: "OBJECT",
    properties: {
      repoName: {
        type: "STRING",
        description:
          "The name of the repository to create (use hyphens instead of spaces)",
      },
    },
    required: ["repoName"],
  },
};

const runTerminalCommandToolDeclaration = {
  name: "runTerminalCommand",
  description:
    "Executes a terminal/command-prompt command on the computer. Highly useful for running git commands, npm installs, or starting servers.",
  parameters: {
    type: "OBJECT",
    properties: {
      command: {
        type: "STRING",
        description:
          "The exact terminal command to execute (e.g., 'git init' or 'git push -u origin main')",
      },
    },
    required: ["command"],
  },
};

const checkInstagramToolDeclaration = {
  name: "checkInstagram",
  description:
    "Opens a web browser, logs into Instagram using environment credentials, and navigates to the user's profile.",
  parameters: {
    type: "OBJECT",
    properties: {}, // No arguments needed!
  },
};

const readFileToolDeclaration = {
  name: "readFile",
  description: "Reads the text content of a file on the computer.",
  parameters: {
    type: "OBJECT",
    properties: {
      filePath: {
        type: "STRING",
        description: "The path to the file to read",
      },
    },
    required: ["filePath"],
  },
};

const searchInFileToolDeclaration = {
  name: "searchInFile",
  description:
    "Searches inside a file for a specific keyword and returns the matching lines and line numbers. Use this on large files instead of readFile to save context space.",
  parameters: {
    type: "OBJECT",
    properties: {
      filePath: { type: "STRING" },
      keyword: {
        type: "STRING",
        description: "The word or variable name to search for",
      },
    },
    required: ["filePath", "keyword"],
  },
};

const writeFileToolDeclaration = {
  name: "writeFile",
  description:
    "Creates a new file OR overwrites an existing file with new content.",
  parameters: {
    type: "OBJECT",
    properties: {
      filePath: {
        type: "STRING",
        description: "The path of the file to create or modify",
      },
      content: {
        type: "STRING",
        description: "The complete, updated text to write inside the file",
      },
    },
    required: ["filePath", "content"], // Gemini MUST provide both!
  },
};

async function main() {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    tools: [
      {
        functionDeclarations: [
          readFileToolDeclaration,
          writeFileToolDeclaration,
          listFilesToolDeclaration,
          checkInstagramToolDeclaration,
          searchInFileToolDeclaration,
          replaceLinesToolDeclaration,
          createGitHubRepoToolDeclaration,
          runTerminalCommandToolDeclaration,
        ],
      },
    ],
    systemInstruction: `You are an expert, highly efficient AI Software Engineer. You must obey these rules strictly:
    1. Do not explore extra files or use tools unnecessarily.
    2. If the user tells you an exact file path, use readFile immediately without listing files.
    3. If asked to deploy or push to GitHub, NEVER use the 'gh' CLI tool. You must use standard git terminal commands ('git init', 'git add .', 'git commit', 'git remote', 'git push').
    4. Never ask the user for permission to run a command, just execute it autonomously.`,
  });

  const history = [
    {
      role: "user",
      parts: [
        {
          text:
            "Please create a new public GitHub repository named 'my-mcp-agent'. After it is created, run local terminal commands to initialize git, add all files, commit with the message 'first commit', and push all my code to the new repository!",
        },
      ],
    },
  ];

  console.log("STARTING THE SUPER AGENT LOOP!!!");

  while (true) {

    await new Promise((resolve)=> setTimeout(resolve, 30000))
    let result = await model.generateContent({ contents: history });
    history.push(result.response.candidates[0].content);

    let functionCalls = result.response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      console.log("\n🤖 Gemini's Final Answer:\n", result.response.text());
      break;
    }

    const call = functionCalls[0];
    console.log(`\n🧠 Gemini says: "I need to use ${call.name}"`);

    let toolResultText = "";

    if (call.name === "readFile") {
      console.log(`⚙️  Reading ${call.args.filePath}...`);
      toolResultText = await readFile(call.args.filePath);
    } else if (call.name === "writeFile") {
      console.log(`⚙️  Creating ${call.args.filePath}...`);
      toolResultText = await writeFile(call.args.filePath, call.args.content);
    } else if (call.name === "listFiles") {
      console.log(`⚙️  Listing files in ${call.args.directoryPath}...`);
      toolResultText = await listFiles(call.args.directoryPath);
    } else if (call.name === "checkInstagram") {
      toolResultText = await checkMyInstagramProfile();
    } else if (call.name === "searchInFile") {
      console.log(
        `⚙️  Searching ${call.args.filePath} for the word: '${call.args.keyword}'...`,
      );
      toolResultText = await searchInFile(
        call.args.filePath,
        call.args.keyword,
      );
    } else if (call.name === "replaceLinesInFile") {
      console.log(
        `⚙️  Replacing lines ${call.args.startLine} to ${call.args.endLine} in ${call.args.filePath}...`,
      );
      toolResultText = await replaceLinesInFile(
        call.args.filePath,
        call.args.startLine,
        call.args.endLine,
        call.args.replacementText,
      );
    } else if (call.name === "createGitHubRepo") {
      console.log(
        `⚙️  Connecting to GitHub to create repo: ${call.args.repoName}...`,
      );
      toolResultText = await createGitHubRepo(call.args.repoName);
    } else if (call.name === "runTerminalCommand") {
      console.log(`💻 Executing terminal command: ${call.args.command}`);
      toolResultText = await runTerminalCommand(call.args.command);
    } else {
      toolResultText = `Error: Tool '${call.name}' does not exist.`;
    }

    history.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: call.name,
            response: { result: toolResultText },
          },
        },
      ],
    });
  }
}

main();
