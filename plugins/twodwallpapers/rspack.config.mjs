import { defineConfig } from "@rspack/cli";
import { fileURLToPath } from "node:url";

export default defineConfig({
  entry: { main: "./src/index.ts" },
  target: "es2022",
  devtool: false,
  output: {
    filename: "[name].js",
    path: fileURLToPath(new URL("./dist", import.meta.url)),
    library: { type: "module" },
  },
  experiments: { outputModule: true },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: { parser: { syntax: "typescript" }, target: "es2022" },
          },
        },
        type: "javascript/auto",
      },
    ],
  },
  resolve: { extensions: [".ts", ".js"], fullySpecified: false },
});
