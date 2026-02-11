import SwiftUI

struct BashCellView: View {
    @Bindable var viewModel: CellViewModel
    @State private var copied = false
    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header row: chevron + title + status badge
            HStack(spacing: 8) {
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))

                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.definition.title)
                        .font(.title3.bold())
                    if let desc = viewModel.definition.description {
                        Text(desc)
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if !isExpanded {
                    statusIcon
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            }

            if isExpanded {
                // Command row: code + copy + run/status
                HStack(spacing: 8) {
                    Text(viewModel.definition.command)
                        .font(.system(size: 14, weight: .regular, design: .monospaced))
                        .lineLimit(nil)
                        .padding(10)
                        .padding(.trailing, 28)
                        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                        .background(.fill.quaternary)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(alignment: .trailing) {
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(viewModel.definition.command, forType: .string)
                                copied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                    copied = false
                                }
                            } label: {
                                Image(systemName: copied ? "checkmark" : "square.on.square")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                    .padding(8)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }

                    statusOrButton
                }

                // Output section
                switch viewModel.state {
                case .completed(let result):
                    OutputView(result: result)
                case .failed(let message):
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(.red)
                default:
                    EmptyView()
                }
            }
        }
        .padding()
        .background(.fill.quinary)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch viewModel.state {
        case .idle:
            EmptyView()
        case .running:
            ProgressView()
                .controlSize(.small)
        case .completed(let result):
            Image(systemName: result.succeeded ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(result.succeeded ? .green : .red)
                .font(.body)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
                .font(.body)
        }
    }

    @ViewBuilder
    private var statusOrButton: some View {
        switch viewModel.state {
        case .idle:
            Button {
                Task { await viewModel.run() }
            } label: {
                Text("Run")
            }
            .buttonStyle(.borderedProminent)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        case .running:
            ProgressView()
                .controlSize(.small)
        case .completed(let result):
            Image(systemName: result.succeeded ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(result.succeeded ? .green : .red)
                .font(.title2)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
                .font(.title2)
        }
    }
}
