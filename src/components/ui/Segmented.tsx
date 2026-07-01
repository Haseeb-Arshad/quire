export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={value === props.value ? "active" : ""}
          aria-pressed={value === props.value}
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
