import Form from "react-bootstrap/Form";

const UnsubmittedFilter: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled = false }) => (
  <Form.Check
    type="switch"
    id="unsubmitted-filter"
    label="Show unsubmitted only"
    checked={checked}
    disabled={disabled}
    onChange={(event) => onChange(event.target.checked)}
  />
);

export default UnsubmittedFilter;
