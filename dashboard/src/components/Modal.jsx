export default function Modal({ title, onClose, children, footer, wide }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={wide ? { maxWidth: 860 } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
