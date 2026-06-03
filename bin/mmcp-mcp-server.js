#!/usr/bin/env node
/**
 * mmcp-core MCP Server launcher
 * 
 * This is a thin Node.js wrapper that spawns the Python MCP server.
 * Used by: npx mmcp-core, Claude Desktop, Codex CLI
 * 
 * Prerequisites: Python 3.11+ with mmcp-core[mcp-server] installed
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Find the Python MCP server
const pythonDir = path.join(__dirname, '..', 'python');
const serverModule = 'mmcp_mcp_server';

// Try python3 first, then python
const pythonCommands = ['python3', 'python'];

function findPython() {
  for (const cmd of pythonCommands) {
    try {
      const result = require('child_process').execSync(
        `${cmd} -c "import sys; print(sys.version_info >= (3, 11))"`,
        { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (result === 'True') return cmd;
    } catch (e) {
      // Try next
    }
  }
  return null;
}

function checkModuleInstalled(pythonCmd) {
  try {
    require('child_process').execSync(
      `${pythonCmd} -c "import mmcp_mcp_server"`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return true;
  } catch (e) {
    return false;
  }
}

function main() {
  const pythonCmd = findPython();
  
  if (!pythonCmd) {
    console.error('Error: Python 3.11+ is required but not found.');
    console.error('Install Python: https://python.org/downloads');
    process.exit(1);
  }

  if (!checkModuleInstalled(pythonCmd)) {
    console.error('mmcp_mcp_server not found. Installing...');
    try {
      // If we have the python dir bundled, install from there
      if (fs.existsSync(path.join(pythonDir, 'pyproject.toml'))) {
        require('child_process').execSync(
          `${pythonCmd} -m pip install -e "${pythonDir}[mcp-server]"`,
          { stdio: 'inherit', timeout: 120000 }
        );
      } else {
        // Install from PyPI
        require('child_process').execSync(
          `${pythonCmd} -m pip install "mmcp-core[mcp-server]"`,
          { stdio: 'inherit', timeout: 120000 }
        );
      }
    } catch (e) {
      console.error('Failed to install mmcp-core. Run manually:');
      console.error(`  ${pythonCmd} -m pip install "mmcp-core[mcp-server]"`);
      process.exit(1);
    }
  }

  // Launch the Python MCP server over stdio
  const server = spawn(pythonCmd, ['-m', serverModule], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env },
  });

  server.on('error', (err) => {
    console.error(`Failed to start MCP server: ${err.message}`);
    process.exit(1);
  });

  server.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Forward signals
  process.on('SIGINT', () => server.kill('SIGINT'));
  process.on('SIGTERM', () => server.kill('SIGTERM'));
}

main();
