{
  description = "Aggregate Codex session trees with ccusage";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    ccusage.url = "github:ccusage/ccusage/v20.0.19";
  };
  outputs = { self, nixpkgs, ccusage }:
    let systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]; in
    { packages = builtins.listToAttrs (map (system: let pkgs = import nixpkgs { inherit system; }; in { name = system; value.default = pkgs.writeShellApplication { name = "codex-session-usage"; runtimeInputs = [ pkgs.bun ccusage.packages.${system}.default ]; text = ''exec bun run ${self}/src/cli.ts "$@"''; }; }) systems);
      apps = builtins.listToAttrs (map (system: { name = system; value.default = { type = "app"; program = "${self.packages.${system}.default}/bin/codex-session-usage"; }; }) systems);
      devShells = builtins.listToAttrs (map (system: let pkgs = import nixpkgs { inherit system; }; in { name = system; value.default = pkgs.mkShell { packages = [ pkgs.bun pkgs.nodePackages.typescript pkgs.nodePackages.prettier ccusage.packages.${system}.default ]; }; }) systems);
    };
}
