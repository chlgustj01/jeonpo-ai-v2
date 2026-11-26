import { type ButtonHTMLAttributes, type ReactNode } from 'react';

// Small reusable primitives shared across features (§4 "공통 버튼, 카드,
// 모달, 배너, 로딩, 오류 안내"). Kept deliberately plain — Tailwind
// utility classes directly, no extra styling abstraction layer, matching
// "불필요한 추상화를 들이지 않는다".

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl p-4 vintage-border vintage-shadow ${className}`}>{children}</div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const base =
    // 44px-ish min touch target height (py-2.5 ~ 10px*2 + line height) per §6 "터치하기 쉬운 버튼"
    'min-h-[44px] px-4 rounded-xl text-sm font-bold transition inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-vintage-terracotta text-white hover:bg-vintage-dark',
    secondary: 'bg-vintage-dark/10 text-vintage-dark hover:bg-vintage-dark/20',
    ghost: 'bg-transparent text-vintage-olive hover:bg-vintage-beige',
    danger: 'bg-red-50 text-red-700 hover:bg-red-100',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-vintage-olive text-sm" role="status" aria-live="polite">
      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="text-center py-8 px-4 text-vintage-olive">
      {icon && <div className="text-3xl mb-2" aria-hidden="true">{icon}</div>}
      <p className="font-semibold text-vintage-dark">{title}</p>
      {description && <p className="text-xs mt-1">{description}</p>}
    </div>
  );
}

export function ErrorNotice({ title, description }: { title: string; description?: string }) {
  return (
    <div className="p-3 rounded-xl bg-red-50 text-red-900 border border-red-200 text-sm" role="alert">
      <p className="font-bold">{title}</p>
      {description && <p className="text-xs mt-0.5">{description}</p>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        className="bg-vintage-cream w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-4 vintage-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="modal-title" className="font-serif text-xl font-bold text-vintage-dark">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-vintage-olive hover:text-vintage-dark text-xl"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-vintage-dark text-vintage-cream px-4 py-3 rounded-lg text-sm font-medium vintage-shadow flex items-center gap-2 max-w-[90%] border border-vintage-clay/20"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
