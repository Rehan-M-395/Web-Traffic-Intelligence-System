import { useEffect } from "react";
import sendVisit, { startHeartbeat } from "./Trackvisit";

export default function Home() {
    useEffect(() => {
        sendVisit();
        startHeartbeat();
    }, []);

    return <h1>Home Page</h1>;
}