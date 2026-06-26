import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import {
  RatingColumn,
  RatingFieldValue,
  YesNoValue,
} from "./ratingTypes";

interface RatingCellProps {
  column: RatingColumn;
  value: RatingFieldValue;
  onChange: (value: RatingFieldValue) => void;
  disabled?: boolean;
}

const RatingCell: React.FC<RatingCellProps> = ({
  column,
  value,
  onChange,
  disabled = false,
}) => {
  if (column.type === "yes_no") {
    const yesNoValue = value as YesNoValue;
    return (
      <div className="d-flex gap-1">
        <Button
          size="sm"
          variant={yesNoValue === "yes" ? "success" : "outline-success"}
          disabled={disabled}
          onClick={() => onChange("yes")}
        >
          Yes
        </Button>
        <Button
          size="sm"
          variant={yesNoValue === "no" ? "danger" : "outline-danger"}
          disabled={disabled}
          onClick={() => onChange("no")}
        >
          No
        </Button>
      </div>
    );
  }

  if (column.type === "text") {
    return (
      <Form.Control
        as="textarea"
        rows={2}
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        placeholder={column.label}
      />
    );
  }

  return <span className="text-muted">Unsupported column type</span>;
};

export default RatingCell;
