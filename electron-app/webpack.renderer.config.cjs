// electron-app/webpack.renderer.config.cjs

const path = require("path");

module.exports = {
  mode: "development",

  target: "web",

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
    extensions: [".tsx", ".ts", ".js"],
  },

  output: {
    filename: "index.js",

    path: path.resolve(__dirname, ".webpack/renderer"),
  },

  devServer: {
    hot: false,
    liveReload: false,
  },
};