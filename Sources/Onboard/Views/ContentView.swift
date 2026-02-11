import SwiftUI

struct ContentView: View {
    @State private var cellViewModels: [CellViewModel] = []
    @State private var errorMessage: String?
    @State private var projectName: String = "Onboard"
    @State private var projectDescription: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text(projectName)
                        .font(.largeTitle.bold())
                    if let desc = projectDescription {
                        Text(desc)
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom, 8)

                if let error = errorMessage {
                    Text(error)
                        .foregroundStyle(.red)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.red.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                ForEach(cellViewModels) { vm in
                    BashCellView(viewModel: vm)
                }
            }
            .padding(24)
        }
        .frame(minWidth: 500, minHeight: 400)
        .task {
            loadYAML()
        }
    }

    private func loadYAML() {
        // Look for example.onboard.yml next to the executable, then fall back to CWD
        let candidates = [
            Bundle.main.bundleURL
                .deletingLastPathComponent()
                .appendingPathComponent("example.onboard.yml"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("example.onboard.yml"),
        ]

        guard let url = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
            errorMessage = "Could not find example.onboard.yml"
            return
        }

        do {
            let onboardFile = try YAMLLoader.load(from: url)
            let repoDir = url.deletingLastPathComponent()
            projectName = onboardFile.name
            projectDescription = onboardFile.description
            cellViewModels = onboardFile.cells.map {
                CellViewModel(definition: $0, workingDirectory: repoDir)
            }
        } catch {
            errorMessage = "Failed to load YAML: \(error.localizedDescription)"
        }
    }
}
