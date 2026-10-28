import { useEffect, useState } from "react";
import { formatPersonName } from "../../utils/formatPersonName";

export default function UserAvatar({ user, className = "" }) {
  const [failed, setFailed] = useState(false);
  const source = user?.profilePicture;

  useEffect(() => setFailed(false), [source]);

  if (source && !failed)
    return (
      <img
        src={source}
        alt={`${formatPersonName(user) || "User"} profile`}
        onError={() => setFailed(true)}
        className={`${className} object-cover`}
      />
    );

  return (
    <span className={`${className} grid place-items-center`} aria-hidden="true">
      {formatPersonName(user)?.[0]?.toUpperCase() || "U"}
    </span>
  );
}
