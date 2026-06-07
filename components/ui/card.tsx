import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  style,
  className,
  onClick,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div className={`card${className ? ` ${className}` : ''}`} style={style} onClick={onClick}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2>{title}</h2>
        {sub && <span className="card-sub">{sub}</span>}
      </div>
      {right}
    </div>
  );
}

export function CardBody({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="card-body" style={style}>
      {children}
    </div>
  );
}
