import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

// Inlined from @packages/shared/constants to support React Email preview
const APP_NAME = "Test Monorepo";
const APP_ADDRESS = "60 rue François 1er, 75008 Paris, France";

interface AdminInviteEmailProps {
  name?: string;
  inviteUrl?: string;
}

export const AdminInviteEmail = ({
  name = "there",
  inviteUrl = "https://admin.example.com/accept-invite?token=xxx",
}: AdminInviteEmailProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className="bg-white font-plaid">
        <Preview>You've been invited to join {APP_NAME} Admin</Preview>
        <Container className="px-3 mx-auto">
          <Text className="text-[#51525C] text-sm my-2">Hi {name},</Text>
          <Text className="text-[#51525C] text-sm my-2">
            You've been invited to join the {APP_NAME} admin team.
          </Text>
          <Text className="text-[#51525C] text-sm my-2">
            Click the button below to set up your account and get started:
          </Text>
          <Section className="text-center my-6">
            <Button
              className="bg-[#000000] rounded-md text-white text-sm font-semibold no-underline text-center px-5 py-3"
              href={inviteUrl}
            >
              Accept Invitation
            </Button>
          </Section>
          <Text className="text-[#51525C] text-sm my-2">
            This invitation will expire in 7 days.
          </Text>
          <Text className="text-[#51525C] text-sm my-2">
            If you didn't expect this invitation, you can safely ignore this email.
          </Text>
          <Text className="text-[#51525C] text-sm my-2">Thanks,</Text>
          <Text className="text-[#51525C] text-sm my-2">
            The {APP_NAME} Team
          </Text>
          <Hr />
          <Text className="text-[#51525C] text-sm my-2">
            © 2025 {APP_NAME}, {APP_ADDRESS}
          </Text>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

AdminInviteEmail.PreviewProps = {
  name: "John",
  inviteUrl: "https://admin.example.com/accept-invite?token=abc123",
} as AdminInviteEmailProps;

export default AdminInviteEmail;
