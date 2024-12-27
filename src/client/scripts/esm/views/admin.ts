const commandInput = document.getElementById("commandInput")! as HTMLInputElement;
const commandHistory = document.getElementById("commandHistory")! as HTMLTextAreaElement;
const sendCommandButton = document.getElementById("sendButton")! as HTMLButtonElement;

async function sendCommand() {
	const commandString: string = commandInput.value;
	if (commandString.length === 0) return; // Don't send command if the input box is empty
	commandInput.value = "";
	const response = await fetch("command/" + commandString);
	commandHistory.textContent += commandString + '\n' + await response.text() + "\n\n";
	scrollToBottom(commandHistory);
}

function clickSubmitIfReturnPressed(event: any) {
	// 13 is the key code for Enter key
	if (event.keyCode === 13) sendCommandButton.click();
}

/**
 * Automatically scrolls to the bottom of the container.
 * @param container - The container to scroll.
 */
function scrollToBottom(container: HTMLElement) {
	container.scrollTo({
		top: container.scrollHeight,
		behavior: 'smooth',
	});
}

sendCommandButton.addEventListener("click", sendCommand);
commandInput.addEventListener('keyup', clickSubmitIfReturnPressed);