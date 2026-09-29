// sign the app so WidevineCDM can work
// https://github.com/castlabs/electron-releases/wiki/EVS

import process from "process";
import { spawn } from "child_process";

/** @type {() => Promise<boolean>} */
function isCastlabsEvsAvailable() {
  return new Promise((resolve) => {
    const probe = spawn("python3", ["-c", "import castlabs_evs"]);
    probe.on("close", (code) => resolve(code === 0));
    probe.on("error", () => resolve(false));
  });
}

/** @type {(appOutDir: string) => Promise<void>} */
async function signAppWithVMP(appOutDir) {
  let signPath = null;
  if (process.platform === "darwin") {
    signPath = appOutDir;
  } else if (process.platform === "win32") {
    signPath = appOutDir;
  }

  if (signPath) {
    console.log(`\nSigning the app for ${process.platform} in ${signPath}`);
    if (!(await isCastlabsEvsAvailable())) {
      console.log("Skipping VMP signing, 'castlabs_evs' module is not installed (pip install castlabs-evs)");
      return Promise.resolve();
    }
    try {
      return new Promise((resolve, reject) => {
        const signProcess = spawn("python3", ["-m", "castlabs_evs.vmp", "--no-ask", "sign-pkg", signPath]);

        signProcess.stdout.on("data", (data) => {
          console.log(data.toString());
        });

        signProcess.stderr.on("data", (data) => {
          console.error(data.toString());
        });

        signProcess.on("close", (code) => {
          if (code === 0) {
            console.log("Signing completed successfully");
            resolve();
          } else {
            const error = new Error(`Signing process exited with code ${code}`);
            console.error(error.message);
            reject(error);
          }
        });

        signProcess.on("error", (error) => {
          console.error("Error in signing process:", error.message);
          reject(error);
        });
      });
    } catch (error) {
      console.error("Error starting signing process:", error.message);
      // Ignore errors, we can still build the app
      return Promise.resolve(); // Resolve anyway so build can continue
    }
  } else {
    console.log("\nSkipping signing the app, no signPath found\n");
    return Promise.resolve();
  }
}

export { signAppWithVMP };
