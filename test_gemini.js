import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs/promises";

dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function readFile(filePath) {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }
}

const readFileToolDeclaration = {
    name: "readFile",
    description: "Reads the text content of a file on the computer.",
    parameters: {
        type: "OBJECT",
        properties: {
            filePath: {
                type: "STRING",
                description: "The path to the file to read",
            }
        },
        required: ["filePath"],
    },
};

async function main() {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        tools: [{ functionDeclarations: [readFileToolDeclaration] }]
    });

    const chat = model.startChat();
    let result = await chat.sendMessage("Can you read package.json and tell me the 'name' of the project?");
    let functionCalls = result.response.functionCalls(); 
    
    if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        const fileContent = await readFile(call.args.filePath);
        const toolResponse = [{
            functionResponse: {
                name: call.name,
                response: { content: fileContent }
            }
        }];
        console.log("history before send:", JSON.stringify(await chat.getHistory(), null, 2));
        result = await chat.sendMessage(toolResponse);
        console.log(result.response.text());
    }
}
main();
