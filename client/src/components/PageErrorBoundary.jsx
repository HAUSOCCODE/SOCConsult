import { Component } from "react";

export default class PageErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("SOCConsult page render failed:", error);
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (this.state.failed) {
      return (
        <section className="rounded-2xl border border-red-200 bg-white px-6 py-12 text-center shadow-sm">
          <h1 className="text-xl font-bold text-red-700">
            Unable to display this page.
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            A page error occurred. Reload the page or return to the dashboard.
          </p>
          <button
            type="button"
            className="btn-primary mt-6"
            onClick={this.retry}
          >
            Try Again
          </button>
          <button type="button" className="btn-secondary ml-3 mt-3 sm:mt-6" onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
