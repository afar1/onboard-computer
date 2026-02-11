import SwiftUI

struct OutputView: View {
    let result: ShellResult
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup("Output", isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 8) {
                if !result.stdout.isEmpty {
                    Text("stdout")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(result.stdout)
                            .font(.system(size: 13, weight: .regular, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }
                if !result.stderr.isEmpty {
                    Text("stderr")
                        .font(.callout)
                        .foregroundStyle(.red.opacity(0.8))
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(result.stderr)
                            .font(.system(size: 13, weight: .regular, design: .monospaced))
                            .foregroundStyle(.red.opacity(0.9))
                            .textSelection(.enabled)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }
}
