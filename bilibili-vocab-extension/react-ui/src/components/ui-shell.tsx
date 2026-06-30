import { AlertIcon, ReplayIcon } from './icons';

interface LoadingPanelProps {
  message?: string;
}

export function LoadingPanel({ message }: LoadingPanelProps) {
  return (
    <>
      <section className="studio-hero stagger-enter">
        <h1 className="studio-title">加载中</h1>
        {message ? <p className="studio-subtitle">{message}</p> : null}
      </section>
      <section className="panel stack stagger-enter">
        <div className="skeleton" style={{ height: '24px', width: '60%' }} />
        <div className="skeleton" style={{ height: '16px', width: '90%' }} />
        <div className="skeleton" style={{ height: '16px', width: '75%' }} />
      </section>
    </>
  );
}

interface ErrorPanelProps {
  title: string;
  suggestion?: string;
  onRetry: () => void;
}

export function ErrorPanel({ title, suggestion, onRetry }: ErrorPanelProps) {
  return (
    <section className="panel stack stagger-enter" aria-live="assertive" aria-atomic="true">
      <div className="inline wrap">
        <div>
          <h3>
            <AlertIcon size={16} />
            {title}
          </h3>
          {suggestion ? <p className="panel-subtitle">{suggestion}</p> : null}
        </div>
        <button type="button" className="btn secondary" onClick={onRetry}>
          <ReplayIcon size={14} />
          重试
        </button>
      </div>
    </section>
  );
}

interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return <div className="bsv-empty-state">{message}</div>;
}
