// electron-app/forge.config.cjs

const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseVersion, FuseV1Options } = require("@electron/fuses");
const path = require("path");

module.exports = {
  packagerConfig: {
    asar: true,
    name: "Context_Aware_AI_Desktop_Assistant",
    appBundleId: "com.yourname.ai-assistant",
    icon: "./assets/icon",
  },

  rebuildConfig: {},

  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "Context_Aware_AI_Desktop_Assistant",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {},
    },
  ],

 plugins: [
  {
    name: "@electron-forge/plugin-webpack",

    config: {
      mainConfig: path.resolve(__dirname, "webpack.main.config.cjs"),

      renderer: {
        config: path.resolve(
          __dirname,
          "webpack.renderer.config.cjs"
        ),

        entryPoints: [
          {
            name: "main_window",

            html: "./src/renderer/index.html",

            js: "./src/renderer/index.tsx",

            preload: {
              js: "./src/preload/preload.ts",
            },
          },
        ],
      },

      devContentSecurityPolicy:
        "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' http://localhost:3001 ws://localhost:9000 https://sds9n3ijta.execute-api.ap-south-1.amazonaws.com/prod2;",
    },
  },
],
};