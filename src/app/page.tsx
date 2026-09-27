// The landing page is onboarding: the form floats over the live world ("Skip, just explore" opens /world).
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/onboarding");
}
