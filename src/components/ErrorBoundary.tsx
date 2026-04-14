import * as React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public props: Props;
  public state: State;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { hasError, error } = this.state;
    const { children } = this.props;

    if (hasError) {
      let errorMessage = "Đã có lỗi xảy ra. Vui lòng thử lại sau.";
      
      try {
        // Check if it's a Firestore error JSON
        if (error?.message) {
          const parsed = JSON.parse(error.message);
          if (parsed.error && parsed.operationType) {
            errorMessage = `Lỗi kết nối dữ liệu (${parsed.operationType}): ${parsed.error}`;
          }
        }
      } catch (e) {
        // Not a JSON error, use default or raw message
        if (error?.message) {
          errorMessage = error.message;
        }
      }

      return (
        <div className="h-screen flex flex-col items-center justify-center p-6 text-center bg-[#F2F2F7]">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          </div>
          <h1 className="text-xl font-bold text-black mb-2">Rất tiếc!</h1>
          <p className="text-gray-600 mb-6 max-w-xs">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-[#007AFF] text-white px-6 py-2 rounded-xl font-semibold shadow-lg shadow-[#007AFF]/20 active:scale-95 transition-all"
          >
            Tải lại trang
          </button>
        </div>
      );
    }

    return children;
  }
}
