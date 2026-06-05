const path = require("path");

module.exports = {
  mode: "production",

  target: "electron-main",

  entry: "./src/main/main.ts",

  devtool: "source-map",

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: "ts-loader",
      },
    ],
  },

  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },



  node: {
    __dirname: false,
    __filename: false,
  },
};